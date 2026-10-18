import { MarketplaceError, type ErrorCode } from "@atm/shared";
import { withDeadline } from "./deadline.js";

/** Fetch-only MCP client, usable inside wasi:http without Node or the MCP SDK. */
export class FetchMarketplace {
  private session?: string;
  private version = "2025-06-18";
  private nextId = 0;
  private ready = false;

  constructor(private readonly url: string, private readonly apiKey: string, private readonly fetcher: typeof fetch) {}

  private async rpc(method: string, params: unknown, notification = false): Promise<any> {
    const id = ++this.nextId;
    return withDeadline(async (signal) => {
      const res = await this.fetcher(this.url, {
        method: "POST", redirect: "error", signal,
        headers: {
          "content-type": "application/json", accept: "application/json, text/event-stream",
          authorization: `Bearer ${this.apiKey}`, "mcp-protocol-version": this.version,
          ...(this.session ? { "mcp-session-id": this.session } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }),
      });
      if (!res.ok) throw new Error(`MARKETPLACE_HTTP_${res.status}`);
      this.session = res.headers.get("mcp-session-id") ?? this.session;
      if (notification) { await res.body?.cancel(); return; }
      const response = await readRpcResponse(res, id);
      if (response.error) throw new Error(`MCP_RPC_${response.error.code ?? "ERROR"}`);
      return response.result;
    }, 20_000, "MARKETPLACE_TIMEOUT");
  }

  private async init() {
    if (this.ready) return;
    const init = await this.rpc("initialize", { protocolVersion: this.version, capabilities: {}, clientInfo: { name: "atm-sandbox", version: "0.2.0" } });
    this.version = init.protocolVersion ?? this.version;
    await this.rpc("notifications/initialized", {}, true);
    this.ready = true;
  }

  /** Names of the tools the server offers (feature detection across contract versions). */
  async toolNames(): Promise<string[]> {
    await this.init();
    const result = await this.rpc("tools/list", {});
    return ((result?.tools ?? []) as { name?: unknown }[]).map((t) => t.name).filter((n): n is string => typeof n === "string");
  }

  async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.init();
    const result = await this.rpc("tools/call", { name, arguments: args });
    const value = result.structuredContent ?? JSON.parse(result.content?.find((c: { type: string }) => c.type === "text")?.text ?? "{}");
    if (result.isError || value.error) {
      const code: ErrorCode = value.error?.code ?? "INTERNAL_ERROR";
      // Remote error text can contain payloads. Cross the sandbox boundary with a code only.
      throw new MarketplaceError(code, code, { retryable: value.error?.retryable });
    }
    return value as T;
  }
}

async function readRpcResponse(res: Response, id: number): Promise<any> {
  if (!res.headers.get("content-type")?.includes("text/event-stream")) {
    const json = await res.json() as { id?: number };
    if (json.id !== id) throw new Error("MCP_RESPONSE_ID_MISMATCH");
    return json;
  }
  if (!res.body) throw new Error("MCP_EMPTY_RESPONSE");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 2_000_000) throw new Error("MCP_RESPONSE_TOO_LARGE");
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const json = JSON.parse(data) as { id?: number };
        if (json.id === id) return json;
      }
      if (chunk.done) throw new Error("MCP_RESPONSE_MISSING");
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export function safeFailureCode(error: unknown): string {
  if (error instanceof MarketplaceError) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  if (/^[A-Z][A-Z0-9_]{2,80}$/.test(message)) return message;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "TASK_TIMEOUT";
  return "RUNNER_FAILED";
}
