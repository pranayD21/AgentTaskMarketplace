/**
 * Wassette (Wasmtime) sandbox runtime.
 *
 * Spawns `wassette run` (MCP over stdio), loads runner.wasm under a
 * role-specific component id so each role gets its own deny-by-default
 * policy, grants exactly the permissions the role needs, and calls the
 * component's exported functions as MCP tools. The daemon never sees a
 * decrypted task: it only moves ciphertext in and out of the sandbox.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JudgeTaskOutput, RunTaskOutput, type Envelope, type KeyDescriptor } from "@atm/shared";
import type { JudgeCycleOpts, JudgeCycleOutput, JudgeTaskOpts, RunTaskOpts } from "@atm/runner-core";
import type { Runtime, RuntimeInfo } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const WASM_SRC = path.join(REPO_ROOT, "packages/runner-wasm/dist/runner.wasm");

interface Grants { network: string[]; env: string[] }
const GRANTS: Record<"seller" | "judge", Grants> = {
  seller: { network: ["localhost:11434", "127.0.0.1:11434"], env: [] },
  // judge-cycle: the runner calls the marketplace itself (host added from MARKETPLACE_URL at runtime).
  judge: { network: ["api.anthropic.com"], env: ["AGENT_API_KEY", "ANTHROPIC_API_KEY", "JUDGE_PRIVATE_KEY_B64"] },
};

export interface WassetteOptions {
  judgePrivateKeyB64?: string;
  /** The daemon's marketplace API key, handed to the runner through the env grant. */
  agentApiKey?: string;
  /** Its host(:port) is added to the role's network grant. */
  marketplaceUrl?: string;
}

export class WassetteRuntime implements Runtime {
  private client: Client | null = null;
  private componentId = "";
  private readonly wasmSha256: string;
  private readonly componentDir: string;
  private version: string | null = null;
  private readonly grants: Grants;
  private readonly judgePrivateKeyB64?: string;
  private readonly agentApiKey?: string;

  constructor(private readonly role: "seller" | "judge", opts: WassetteOptions = {}) {
    this.judgePrivateKeyB64 = opts.judgePrivateKeyB64;
    this.agentApiKey = opts.agentApiKey;
    // Wassette parses "localhost:3000" as a scheme, so grant the full origin.
    // ATM_DEMO_NO_MARKETPLACE_GRANT=1 withholds it to show the policy blocking the call.
    const mpHost = opts.marketplaceUrl && role === "judge" && !process.env.ATM_DEMO_NO_MARKETPLACE_GRANT ? new URL(opts.marketplaceUrl).origin : null;
    this.grants = { network: [...(mpHost ? [mpHost] : []), ...GRANTS[role].network], env: GRANTS[role].env };
    if (!fs.existsSync(WASM_SRC)) throw new Error(`runner.wasm not built; run: pnpm build:runner (expected ${WASM_SRC})`);
    this.wasmSha256 = createHash("sha256").update(fs.readFileSync(WASM_SRC)).digest("hex");
    // Wassette persists grants per component dir, so the no-grant demo needs its own.
    this.componentDir = path.join(REPO_ROOT, ".atm-state", `wassette-${role}${process.env.ATM_DEMO_NO_MARKETPLACE_GRANT ? "-nogrant" : ""}`);
    fs.mkdirSync(this.componentDir, { recursive: true });
  }

  info(): RuntimeInfo {
    return {
      runtime: "wassette",
      wasm_sha256: this.wasmSha256,
      wassette_version: this.version,
      description: `Wasmtime component under Wassette ${this.version ?? ""}; network allow-list: ${this.grants.network.join(", ")}`,
    };
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    // Judge secrets travel into the sandbox through Wassette's env permission
    // (surfaced to the component as wasi:config/store), never as tool arguments.
    if (this.role === "judge") {
      if (!this.judgePrivateKeyB64 || !process.env.ANTHROPIC_API_KEY) throw new Error("judge role needs JUDGE_PRIVATE_KEY_B64 and ANTHROPIC_API_KEY");
      env.JUDGE_PRIVATE_KEY_B64 = this.judgePrivateKeyB64;
      if (this.agentApiKey) env.AGENT_API_KEY = this.agentApiKey;
    }
    const args = ["run", "--component-dir", this.componentDir, ...this.grants.env.flatMap((k) => ["--env", `${k}=${env[k] ?? ""}`])];
    const transport = new StdioClientTransport({ command: "wassette", args, env, stderr: "pipe" });
    const client = new Client({ name: `atm-${this.role}-daemon`, version: "0.1.0" });
    await client.connect(transport);
    transport.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (/denied|error|warn/i.test(line)) console.log(`[wassette] ${line.slice(-900)}`);
    });
    const info = client.getServerVersion();
    this.version = info?.version ?? null;

    // Each role loads the same bytes under its own id so policies stay separate.
    const target = path.join(this.componentDir, `atm-${this.role}-runner.wasm`);
    fs.copyFileSync(WASM_SRC, target);
    const loaded = await this.callRaw(client, "load-component", { path: `file://${target}` });
    this.componentId = (loaded.id as string | undefined) ?? `atm-${this.role}-runner`;
    for (const host of this.grants.network) {
      await this.callRaw(client, "grant-network-permission", { component_id: this.componentId, details: { host } });
    }
    for (const key of this.grants.env) {
      await this.callRaw(client, "grant-environment-variable-permission", { component_id: this.componentId, details: { key } });
    }
    const tools = (await client.listTools()).tools.map((t) => t.name);
    console.log(`[wassette] loaded ${this.componentId} (sha256 ${this.wasmSha256.slice(0, 12)}…) tools: ${tools.filter((t) => !t.includes("permission") && !t.includes("component")).join(", ")}`);
    this.client = client;
    return client;
  }

  private async callRaw(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? "";
    if (res.isError) throw new Error(`${name}: ${text.slice(0, 500)}`);
    try { return JSON.parse(text) as Record<string, unknown>; } catch { return { text }; }
  }

  /** Call a component export; unwraps Wassette's {result} / {ok|err} envelopes and the string payload. */
  private async callComponent<T>(name: string, args: Record<string, unknown>, schema: { parse(v: unknown): T }): Promise<T> {
    const client = await this.connect();
    const raw = await this.callRaw(client, name, args);
    let value: unknown = "result" in raw ? raw.result : raw;
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      if ("err" in v) throw new Error(`sandbox ${name} failed: ${String(v.err)}`);
      if ("ok" in v) value = v.ok;
      else if ("text" in v) value = v.text;
    }
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return schema.parse(parsed);
  }

  async getPublicKey(): Promise<KeyDescriptor> {
    return this.callComponent("get-public-key", {}, { parse: (v) => v as KeyDescriptor });
  }

  async runTask(envelope: Envelope, opts: RunTaskOpts) {
    return this.callComponent("run-task", { "seller-envelope": JSON.stringify(envelope), opts: JSON.stringify(opts) }, RunTaskOutput);
  }

  async judgeTask(taskEnvelope: Envelope, resultEnvelope: Envelope, opts: JudgeTaskOpts) {
    return this.callComponent(
      "judge-task",
      { "task-envelope": JSON.stringify(taskEnvelope), "result-envelope": JSON.stringify(resultEnvelope), opts: JSON.stringify(opts) },
      JudgeTaskOutput,
    );
  }

  async judgeCycle(opts: JudgeCycleOpts) {
    return this.callComponent("judge-cycle", { opts: JSON.stringify(opts) }, { parse: (v) => v as JudgeCycleOutput });
  }

  async close() {
    await this.client?.close().catch(() => {});
    this.client = null;
  }
}
