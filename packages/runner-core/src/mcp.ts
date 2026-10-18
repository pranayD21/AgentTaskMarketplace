/**
 * Minimal MCP (streamable HTTP) client over the injected `fetch`, so the
 * runner can talk to the marketplace from inside the Wasm sandbox where the
 * MCP SDK cannot load. Handles JSON and single-event SSE responses.
 */
import { MarketplaceError, type ErrorCode } from "@atm/shared";

export class McpFetchClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(private readonly fetchFn: typeof fetch, private readonly url: string, private readonly apiKey: string) {}

  private async rpc(method: string, params: Record<string, unknown>, notification = false): Promise<Record<string, unknown> | null> {
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${this.apiKey}`,
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify(notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: this.nextId++, method, params }),
    });
    this.sessionId = res.headers.get("mcp-session-id") ?? this.sessionId;
    const text = await res.text();
    if (notification) return null;
    if (!res.ok) throw new Error(`marketplace HTTP ${res.status} on ${method}: ${text.slice(0, 200)}`);
    const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).find(Boolean);
    const json = JSON.parse(data ?? text) as { result?: Record<string, unknown>; error?: { message?: string } };
    if (json.error) throw new Error(`marketplace ${method}: ${json.error.message ?? "error"}`);
    return json.result ?? {};
  }

  private async init() {
    if (this.initialized) return;
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "atm-runner", version: "0.1.0" } });
    await this.rpc("notifications/initialized", {}, true);
    this.initialized = true;
  }

  async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.init();
    const res = (await this.rpc("tools/call", { name, arguments: args })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    const text = res.content?.find((c) => c.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text) as T & { error?: { code: ErrorCode; message: string; retryable?: boolean; next_action?: string } };
    if (res.isError || parsed.error) {
      const e = parsed.error ?? { code: "INTERNAL_ERROR" as ErrorCode, message: text.slice(0, 200) };
      throw new MarketplaceError(e.code, e.message, { retryable: e.retryable, next_action: e.next_action });
    }
    return parsed;
  }
}
