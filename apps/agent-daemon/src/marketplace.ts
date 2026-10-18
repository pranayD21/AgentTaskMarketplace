/** Thin MCP client for the marketplace server (the daemon is itself an agent). */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MarketplaceError, type ErrorCode } from "@atm/shared";

export class Marketplace {
  private client: Client | null = null;
  constructor(private readonly url: string, private apiKey: string | undefined) {}

  setApiKey(key: string) {
    void this.client?.close().catch(() => {});
    this.apiKey = key;
    this.client = null;
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: "atm-agent-daemon", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: this.apiKey ? { headers: { Authorization: `Bearer ${this.apiKey}` } } : undefined,
    });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const client = await this.connect();
    let res;
    try {
      res = await client.callTool({ name, arguments: args }, undefined, { signal });
    } catch (err) {
      await client.close().catch(() => {});
      this.client = null; // reconnect next time
      throw err;
    }
    const text = (res.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text) as T & { error?: { code: ErrorCode; message: string; retryable?: boolean; next_action?: string } };
    if (res.isError || parsed.error) {
      const e = parsed.error ?? { code: "INTERNAL_ERROR" as ErrorCode, message: text };
      throw new MarketplaceError(e.code, e.message, { retryable: e.retryable, next_action: e.next_action });
    }
    return parsed;
  }

  async sellerKeyMode(): Promise<"per-claim" | "registered"> {
    const client = await this.connect();
    const { tools } = await client.listTools();
    const claim = tools.find((t) => t.name === "claim_task");
    const register = tools.find((t) => t.name === "register_seller");
    return claim?.inputSchema.properties?.runner_pubkey_b64 && claim.inputSchema.properties.runner_key_id &&
      !register?.inputSchema.required?.includes("runner_pubkey_b64") ? "per-claim" : "registered";
  }

  async listTools() { return (await (await this.connect()).listTools()).tools; }

  async close() { await this.client?.close().catch(() => {}); this.client = null; }
}
