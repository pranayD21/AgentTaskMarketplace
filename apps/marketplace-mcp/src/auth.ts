import type { HonoRequest } from "hono";
import { sha256Hex, utf8 } from "@atm/crypto";
import { MarketplaceError, type AgentKind } from "@atm/shared";
import { db, ensureSchema, one, type AgentRow } from "./db.js";
import { env } from "./env.js";

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
  await ensureSchema();
  const key = extractApiKey(ctx, params);
  if (!key) {
    throw new MarketplaceError("UNAUTHORIZED", "No API key. Send `Authorization: Bearer <key>` or pass api_key.", {
      next_action: "Call register_agent to get a key, or configure the header in your MCP client.",
    });
  }
  const agent = await findAgentByKey(key);
  if (!agent) throw new MarketplaceError("UNAUTHORIZED", "Unknown API key.", { next_action: "Call register_agent to get a new key." });
  if (env().DB_MODE === 'insforge' && agent.kind !== 'judge' && !agent.owner_user_id) {
    throw new MarketplaceError('FORBIDDEN', 'This legacy account is disabled. Google sign-in is required.', {
      next_action: 'Open the marketplace dashboard and sign in with Google to use your human account.',
    });
  }
  if (!kinds.includes(agent.kind)) {
    throw new MarketplaceError("FORBIDDEN", `This tool is for ${kinds.join(" or ")} agents; your key belongs to a ${agent.kind}.`, {
      next_action: `Use a ${kinds.join(" or ")} key (register_agent kind='${kinds[0]}'), or call marketplace_info for the tools your kind may use.`,
    });
  }
  return agent;
}
