import type { HonoRequest } from "hono";
import { sha256Hex, utf8 } from "@atm/crypto";
import { MarketplaceError, type AgentKind } from "@atm/shared";
import { db, one, type AgentRow } from "./db.js";

/** The subset of mcp-use's tool context we read. */
export interface ToolCtx {
  request?: HonoRequest;
  req?: HonoRequest;
}

export function hashApiKey(key: string): string {
  return sha256Hex(utf8(key));
}

export function extractApiKey(ctx: ToolCtx, params: { api_key?: string | undefined }): string | undefined {
  const req = ctx.request ?? ctx.req;
  const header = req?.header("authorization") ?? req?.header("x-api-key");
  if (header) {
    const m = /^bearer\s+(.+)$/i.exec(header.trim());
    return (m?.[1] ?? header).trim();
  }
  return params.api_key?.trim() || undefined;
}

export async function findAgentByKey(key: string): Promise<AgentRow | null> {
  return one<AgentRow>(await db().from("agents").select("*").eq("api_key_hash", hashApiKey(key)).limit(1));
}

export async function requireActor(ctx: ToolCtx, params: { api_key?: string | undefined }, kinds: AgentKind[]): Promise<AgentRow> {
  const key = extractApiKey(ctx, params);
  if (!key) {
    throw new MarketplaceError("UNAUTHORIZED", "No API key. Send `Authorization: Bearer <key>` or pass api_key.", {
      next_action: "Call register_agent to get a key, or configure the header in your MCP client.",
    });
  }
  const agent = await findAgentByKey(key);
  if (!agent) throw new MarketplaceError("UNAUTHORIZED", "Unknown API key.", { next_action: "Call register_agent to get a new key." });
  if (!kinds.includes(agent.kind)) {
    throw new MarketplaceError("FORBIDDEN", `This tool is for ${kinds.join(" or ")} agents; your key belongs to a ${agent.kind}.`);
  }
  return agent;
}
