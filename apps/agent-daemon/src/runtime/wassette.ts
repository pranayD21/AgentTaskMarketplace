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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JudgeTaskOutput, RunTaskOutput, MarketplaceError, ERROR_CODES, type ErrorCode, type Envelope, type KeyDescriptor } from "@atm/shared";
import { safeSellerUsage, safeFailureCode, type CanaryOpts, type CanaryOutput } from "@atm/runner-core";
import type { JudgeCycleOpts, JudgeCycleOutput, JudgeTaskOpts, RunTaskOpts, RunCycleOpts, RunCycleOutput } from "@atm/runner-core";
import { z } from "zod";
import type { Runtime, RuntimeInfo } from "./types.js";
import type { SandboxObserver } from "../viewer/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.ATM_APP_ROOT ? path.resolve(process.env.ATM_APP_ROOT) : path.resolve(here, "../../../..");
const WASM_SRC = path.join(REPO_ROOT, "packages/runner-wasm/dist/runner.wasm");

interface Grants { network: string[]; env: string[] }
export interface WassetteOptions {
  apiKey?: string;
  marketplaceUrl?: string;
  ollamaUrl?: string;
  denyOllama?: boolean;
  /** Judge demo: withhold the marketplace origin so the policy blocks judge-cycle. */
  denyMarketplace?: boolean;
  stateDir?: string;
  /** Live view (`--viewer`): receives instance lifecycle, calls and stderr. */
  observer?: SandboxObserver;
}

export function sellerGrants(marketplaceUrl: string, ollamaUrl: string, denyOllama = false): Grants {
  const host = (value: string) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Expected an HTTP(S) URL without credentials");
    return url;
  };
  const marketplace = host(marketplaceUrl);
  const ollama = host(ollamaUrl);
  // Wassette 0.8 matches scheme + hostname, ignoring ports. A full origin also
  // avoids its parser treating bare localhost:port as a URL scheme.
  if (denyOllama && marketplace.hostname === ollama.hostname && marketplace.protocol === ollama.protocol) throw new Error("Denied-host demo needs distinct hostnames; use 127.0.0.1 for marketplace and localhost for Ollama");
  return { network: [...new Set([marketplace.origin, ...(denyOllama ? [] : [ollama.origin])])], env: ["AGENT_API_KEY"] };
}

export function judgeGrants(marketplaceUrl: string, denyMarketplace = false): Grants {
  const marketplace = new URL(marketplaceUrl);
  if (!["http:", "https:"].includes(marketplace.protocol) || marketplace.username || marketplace.password) throw new Error("Expected an HTTP(S) URL without credentials");
  return {
    network: [...(denyMarketplace ? [] : [marketplace.origin]), "https://api.anthropic.com"],
    env: ["AGENT_API_KEY", "ANTHROPIC_API_KEY", "JUDGE_PRIVATE_KEY_B64"],
  };
}

const JudgeUsageRow = z.object({
  purpose: z.enum(["grade", "replacement"]), attempt: z.number().int(), model: z.string(), outcome: z.string(), duration_ms: z.number(),
  input_tokens: z.number().nullable(), output_tokens: z.number().nullable(),
  cache_creation_input_tokens: z.number().nullable(), cache_read_input_tokens: z.number().nullable(),
});
const JudgeCycleResult = z.union([
  z.object({ idle: z.literal(true) }),
  z.object({
    idle: z.literal(false), kind: z.literal("deferred"), deferred: z.literal(true), task_id: z.string(), result_id: z.string(),
    failure_code: z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/), reported_code: z.string().nullable(),
    review: z.object({ status: z.string(), attempts: z.number(), retry_at: z.string().nullable() }).nullable(), usage: z.array(JudgeUsageRow),
  }),
  z.object({
    idle: z.literal(false), kind: z.literal("replacement"), deferred: z.literal(false), task_id: z.string(), result_id: z.string(),
    outcome: z.enum(["delivered", "retry"]), failure_code: z.string().nullable(), replacement_status: z.string().nullable(), usage: z.array(JudgeUsageRow),
  }),
  z.object({
    idle: z.literal(false), kind: z.literal("verdict"), deferred: z.literal(false), task_id: z.string(), result_id: z.string(), verdict: z.enum(["APPROVE", "REJECT"]),
    reason_code: z.string(), reason_public: z.string(), score: z.number().optional(),
    replacement_status: z.enum(["not_needed", "available", "unavailable"]), replacement_failure_code: z.string().nullable(),
    seller_status: z.string().nullable(), seller_payout_cents: z.number().nullable(), settlement_note: z.string().nullable(),
    usage: z.array(JudgeUsageRow),
  }),
]);

const CycleOutput = z.object({
  task_id: z.string(), claim_id: z.string(), result_id: z.string(), runtime_ms: z.number().nonnegative(),
  tokens_out: z.number().nonnegative().optional(), key_id: z.string(), price_cents: z.number().int().positive(),
  seller_usage: z.unknown().transform(safeSellerUsage).optional(),
});

const MeasuredOutput = z.union([
  z.object({ ok: z.literal(true), result: CycleOutput, seller_usage: z.unknown().transform(safeSellerUsage) }),
  z.object({ ok: z.literal(false), error_code: z.string(), seller_usage: z.unknown().transform(safeSellerUsage) }),
]);
const tryJson = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v) as unknown; } catch { return v; } };

const CanaryResult = z.object({ passed: z.boolean(), runtime_ms: z.number().nonnegative(), seller_usage: z.unknown().transform(safeSellerUsage) });

export class WassetteRuntime implements Runtime {
  private client: Client | null = null;
  private componentId = "";
  private readonly wasmSha256: string;
  private componentDir = "";
  private readonly grants: Grants;
  private transport: StdioClientTransport | null = null;
  private version: string | null = null;
  private measured = false;
  private vmId = "";
  private taskFailure = false;

  constructor(private readonly role: "seller" | "judge", private readonly judgePrivateKeyB64?: string, private readonly options: WassetteOptions = {}) {
    if (!fs.existsSync(WASM_SRC)) throw new Error(`runner.wasm not built; run: pnpm build:runner (expected ${WASM_SRC})`);
    this.wasmSha256 = createHash("sha256").update(fs.readFileSync(WASM_SRC)).digest("hex");
    this.grants = role === "seller"
      ? sellerGrants(options.marketplaceUrl ?? process.env.MARKETPLACE_URL ?? "http://localhost:3000/mcp", options.ollamaUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434", options.denyOllama)
      : judgeGrants(options.marketplaceUrl ?? process.env.MARKETPLACE_URL ?? "http://localhost:3000/mcp", options.denyMarketplace);
    this.version = execFileSync("wassette", ["--version"], { encoding: "utf8" }).trim().split(/\s+/)[0] ?? "unknown";
  }

  info(): RuntimeInfo {
    return {
      runtime: "wassette",
      wasm_sha256: this.wasmSha256,
      wassette_version: this.version,
      description: `Wassette ${this.version}; configured origins: ${this.grants.network.join(", ")}; Wassette 0.8 enforces hostnames, not ports`,
    };
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
    const root = path.join(this.options.stateDir ?? path.join(REPO_ROOT, ".atm-state"), `wassette-${this.role}`);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.componentDir = fs.mkdtempSync(path.join(root, "session-"));
    env.AGENT_API_KEY = this.options.apiKey ?? process.env.AGENT_API_KEY ?? "";
    if (!env.AGENT_API_KEY) throw new Error(`${this.role === "seller" ? "Seller" : "Judge"} cycle requires AGENT_API_KEY`);
    // Judge secrets travel into the sandbox through Wassette's env permission
    // (surfaced to the component as wasi:config/store), never as tool arguments.
    if (this.role === "judge") {
      if (!this.judgePrivateKeyB64 || !process.env.ANTHROPIC_API_KEY) throw new Error("judge role needs JUDGE_PRIVATE_KEY_B64 and ANTHROPIC_API_KEY");
      env.JUDGE_PRIVATE_KEY_B64 = this.judgePrivateKeyB64;
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    }
    // Use an owner-only env file so secrets do not appear in process arguments.
    const secrets = path.join(this.componentDir, "runtime.env");
    fs.writeFileSync(secrets, this.grants.env.map((k) => `${k}=${JSON.stringify(env[k] ?? "")}`).join("\n") + "\n", { mode: 0o600 });
    const args = ["run", "--component-dir", this.componentDir, "--env-file", secrets];
    const transport = new StdioClientTransport({ command: "wassette", args, env, stderr: "pipe" });
    const client = new Client({ name: `atm-${this.role}-daemon`, version: "0.1.0" });
    this.transport = transport;
    const observer = this.options.observer;
    const vm = this.vmId = observer?.vmStarted({ role: this.role, runtime: "wassette", wassette_version: this.version, wasm_sha256: this.wasmSha256, network: this.grants.network, env: this.grants.env }) ?? "";
    transport.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (observer) for (const l of line.split("\n")) if (l.trim()) observer.stderr(vm, l);
      // Keep permission evidence, without forwarding arbitrary request or response bodies.
      if (/HTTP request blocked by network policy|Network access denied/i.test(line)) console.log(`[wassette] HTTP request blocked by network policy (configured origins: ${this.grants.network.join(", ")})`);
    });
    try {
      await client.connect(transport);
      observer?.vmUpdate(vm, { pid: transport.pid });

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
      this.measured = tools.includes("run-cycle-measured");
      console.log(`[wassette] loaded ${this.componentId}; sha256=${this.wasmSha256}; ${this.version}; allow-list=${this.grants.network.join(", ")}`);
      if (this.role === "seller") console.log("[wassette] policy enforces scheme + hostname; Wassette 0.8 does not restrict ports.");
      if (this.role === "seller" && !tools.includes("run-cycle")) throw new Error("Rebuild runner.wasm: run-cycle export missing");
      if (this.role === "judge" && !tools.includes("judge-cycle")) throw new Error("Rebuild runner.wasm: judge-cycle export missing");
      if (this.role === "judge") console.log("[wassette] judge key, model key and agent key reach the component only through the env grant; the daemon sees the public verdict only.");
      if (this.role === "seller") console.log("[wassette] task private key stays inside each call; the daemon does not receive it. The host OS can inspect sandbox memory and Ollama.");
      this.client = client;
      observer?.vmUpdate(vm, { state: "ready", component: this.componentId });
      return client;
    } catch (error) { await client.close().catch(() => {}); await this.close(`boot failed: ${safeFailureCode(error)}`); throw error; }
  }

  private async callRaw(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const observer = this.options.observer;
    if (!observer) return this.callTool(client, name, args);
    const started = Date.now();
    const shown = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, tryJson(v)]));
    observer.step(this.vmId, name, "start", { args: shown.opts ?? shown.details ?? shown });
    try {
      const out = await this.callTool(client, name, args);
      const raw = "result" in out ? out.result : out;
      const value = raw && typeof raw === "object" && "ok" in raw ? (raw as { ok: unknown }).ok : raw;
      const result = tryJson(value);
      // Failures come back as {err} (component error) or {ok: false, error_code} (run-cycle-measured).
      const err = raw && typeof raw === "object" && "err" in raw ? String((raw as { err: unknown }).err)
        : result && typeof result === "object" && (result as { ok?: unknown }).ok === false ? String((result as { error_code?: unknown }).error_code ?? "FAILED") : undefined;
      observer.step(this.vmId, name, "end", { ok: !err, ms: Date.now() - started, result, ...(err ? { error: err } : {}) });
      return out;
    } catch (error) {
      observer.step(this.vmId, name, "end", { ok: false, ms: Date.now() - started, error: safeFailureCode(error) });
      throw error;
    }
  }

  private async callTool(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.taskFailure=false;
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: ["run-cycle", "run-cycle-measured", "judge-cycle"].includes(name) ? 260_000 : 210_000 });
    const text = (res.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? "";
    if (res.isError) {
      this.taskFailure=true;
      const code = Object.keys(ERROR_CODES).find((c) => text.includes(c));
      if (code) throw new MarketplaceError(code as ErrorCode, code);
      const safe = /\b(?:TASK_TIMEOUT|MODEL_NOT_INSTALLED|RUNNER_FAILED|OLLAMA_HTTP_\d+|MARKETPLACE_HTTP_\d+|MARKETPLACE_TIMEOUT|JUDGE_[A-Z0-9_]+|MISSING_[A-Z_]+)\b/.exec(text)?.[0];
      throw new Error(safe ?? "SANDBOX_CALL_FAILED");
    }
    try { return JSON.parse(text) as Record<string, unknown>; } catch { return { text }; }
  }

  /** Call a component export; unwraps Wassette's {result} / {ok|err} envelopes and the string payload. */
  private async callComponent<T>(name: string, args: Record<string, unknown>, schema: { parse(v: unknown): T }): Promise<T> {
    const client = await this.connect();
    const raw = await this.callRaw(client, name, args);
    let value: unknown = "result" in raw ? raw.result : raw;
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      if ("err" in v) {
        this.taskFailure=true;
        const code = String(v.err);
        if (code in ERROR_CODES) throw new MarketplaceError(code as ErrorCode, code);
        throw new Error(/^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : "SANDBOX_CALL_FAILED");
      }
      if ("ok" in v) value = v.ok;
      else if ("text" in v) value = v.text;
    }
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return schema.parse(parsed);
  }

  async getPublicKey(): Promise<KeyDescriptor> {
    return this.callComponent("get-public-key", {}, { parse: (v) => v as KeyDescriptor });
  }

  async prepare() { await this.connect(); }

  async runCycle(opts: RunCycleOpts): Promise<RunCycleOutput> {
    try {
      await this.connect();
      if (!this.measured) return await this.callComponent("run-cycle", { opts: JSON.stringify(opts) }, CycleOutput);
      const out = await this.callComponent("run-cycle-measured", { opts: JSON.stringify(opts) }, MeasuredOutput);
      if (!out.ok) {
        this.taskFailure=true;
        const code = safeFailureCode(new Error(out.error_code));
        const error = code in ERROR_CODES ? new MarketplaceError(code as ErrorCode, code) : new Error(code);
        throw Object.assign(error, { seller_usage: out.seller_usage });
      }
      return { ...out.result, seller_usage: out.seller_usage ?? undefined };
    }
    catch (error) {
      // A returned task error leaves the sandbox healthy. Only transport failures
      // or an unresponsive invocation require teardown before lease recovery.
      if(!this.taskFailure)await this.close(`stopped after ${safeFailureCode(error)}`);
      throw error;
    }
  }

  async modelCanary(opts: CanaryOpts): Promise<CanaryOutput> {
    try { return await this.callComponent("model-canary", { opts: JSON.stringify(opts) }, CanaryResult); }
    catch (error) { await this.close(`stopped after ${safeFailureCode(error)}`); throw error; }
  }

  async judgeCycle(opts: JudgeCycleOpts): Promise<JudgeCycleOutput> {
    try { return await this.callComponent("judge-cycle", { opts: JSON.stringify(opts) }, JudgeCycleResult) as JudgeCycleOutput; }
    catch (error) { await this.close(`stopped after ${safeFailureCode(error)}`); throw error; }
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

  async close(reason = "closed") {
    if (this.vmId) this.options.observer?.vmClosed(this.vmId, reason);
    this.vmId = "";
    await this.client?.close().catch(() => {});
    await this.transport?.close().catch(() => {});
    this.client = null;
    this.transport = null;
    if (this.componentDir) fs.rmSync(this.componentDir, { recursive: true, force: true });
    this.componentDir = "";
  }
}
