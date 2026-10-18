import { z } from "zod";
import type { MCPServer } from "mcp-use";
import { bodyLimit } from "hono/body-limit";
import { findAgentByKey, hashApiKey } from "./auth.js";
import { db, ensureSchema, one, unwrap, type AgentRow } from "./db.js";
import { env } from "./env.js";
import { payments, PAYOUT_ACCOUNT_RETRY_POLICY } from "./payments.js";

/** Persist bounded retries so ambiguous Stripe outcomes never create a new account. */
export async function ensureHumanPayoutAccount(agent: AgentRow): Promise<AgentRow> {
  if (agent.stripe_account_id || !agent.owner_user_id || payments().mode === "mock") return agent;
  if (!agent.stripe_onboarding_started_at) {
    unwrap(await db().from("agents").update({ stripe_onboarding_started_at: new Date().toISOString() }).eq("id", agent.id).is("stripe_onboarding_started_at", null));
    agent = (await one<AgentRow>(await db().from("agents").select("*").eq("id", agent.id).limit(1)))!;
  }
  if (agent.stripe_account_id) return agent;
  const started = Date.parse(agent.stripe_onboarding_started_at ?? "");
  if (!Number.isFinite(started) || Date.now() - started > PAYOUT_ACCOUNT_RETRY_POLICY.window_hours * 3600_000) throw Error("STRIPE_SETUP_NEEDS_RECONCILIATION");
  const attempts = agent.stripe_onboarding_attempts ?? 0;
  if (attempts >= PAYOUT_ACCOUNT_RETRY_POLICY.max_attempts) throw Error("STRIPE_SETUP_NEEDS_RECONCILIATION");
  if (Date.parse(agent.stripe_onboarding_retry_at ?? "") > Date.now()) return agent;
  const won = unwrap(await db().from("agents").update({ stripe_onboarding_attempts: attempts + 1,
    stripe_onboarding_retry_at: new Date(Date.now() + PAYOUT_ACCOUNT_RETRY_POLICY.backoff_ms).toISOString() })
    .eq("id", agent.id).eq("stripe_onboarding_attempts", attempts).select()) as AgentRow[];
  if (!won.length) return (await one<AgentRow>(await db().from("agents").select("*").eq("id", agent.id).limit(1)))!;
  const payout = await payments().onboardSeller({ id: agent.id, display_name: agent.display_name, human_onboarding: true, email: agent.owner_email ?? undefined });
  if (payout.stripe_account_id) unwrap(await db().from("agents").update({ stripe_account_id: payout.stripe_account_id }).eq("id", agent.id).is("stripe_account_id", null));
  return (await one<AgentRow>(await db().from("agents").select("*").eq("id", agent.id).limit(1)))!;
}

export interface HumanOwner { id: string; email: string; name: string }
export async function verifyGoogleUser(token: string): Promise<HumanOwner> {
  if (!token || token.length > 8192 || !env().INSFORGE_BASE_URL) throw new Error("GOOGLE_SIGN_IN_REQUIRED");
  const response = await fetch(new URL("/api/auth/sessions/current", env().INSFORGE_BASE_URL), {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("GOOGLE_SIGN_IN_REQUIRED");
  const { user } = await response.json() as any;
  // Only the verified InsForge session supplies ownership. Never trust client email/id.
  if (!user || !/^[a-f0-9-]{36}$/i.test(user.id ?? "") || typeof user.email !== "string" ||
      !user.emailVerified || !Array.isArray(user.providers) || !user.providers.includes("google")) throw new Error("GOOGLE_SIGN_IN_REQUIRED");
  return { id: user.id, email: user.email, name: typeof user.profile?.name === "string" ? user.profile.name : user.email };
}

export async function linkSellerIdentity(owner: HumanOwner, apiKey: string, displayName: string) {
  await ensureSchema();
  const hash = hashApiKey(apiKey);
  let agent = await findAgentByKey(apiKey);
  if (agent && (agent.kind !== "seller" || (agent.owner_user_id && agent.owner_user_id !== owner.id))) throw new Error("SELLER_BELONGS_TO_ANOTHER_ACCOUNT");
  if (!agent) {
    // The install stores this random key BEFORE the request. A lost response can
    // retry the same identity instead of creating another seller or payout account.
    const id = `seller_${hash.slice(0, 32)}`;
    const result = await db().from("agents").insert({ id, kind: "seller", display_name: displayName,
      api_key_hash: hash, owner_user_id: owner.id, owner_email: owner.email }).select();
    if (result.error) {
      agent = await findAgentByKey(apiKey);
      if (!agent || agent.owner_user_id !== owner.id) throw new Error("SELLER_LINK_FAILED");
    } else agent = (unwrap(result) as AgentRow[])[0]!;
  } else if (!agent.owner_user_id) {
    // Linking a legacy identity requires both its private agent key and Google login.
    unwrap(await db().from("agents").update({ owner_user_id: owner.id, owner_email: owner.email })
      .eq("id", agent.id).is("owner_user_id", null));
    agent = await findAgentByKey(apiKey);
    if (agent?.owner_user_id !== owner.id) throw new Error("SELLER_BELONGS_TO_ANOTHER_ACCOUNT");
  }
  if (!await one(await db().from("sellers").select("agent_id").eq("agent_id", agent!.id).limit(1))) {
    const inserted = await db().from("sellers").insert({ agent_id: agent!.id });
    if (inserted.error && !await one(await db().from("sellers").select("agent_id").eq("agent_id", agent!.id).limit(1))) throw new Error("SELLER_LINK_FAILED");
  }
  // Failure to reach Stripe does not lose the Google identity. The model setup
  // step retries the same account request within the reconciliation window.
  try { agent = await ensureHumanPayoutAccount(agent!); } catch {}
  return { agent_id: agent!.id, display_name: agent!.display_name, owner: { user_id: owner.id, email: owner.email, name: owner.name } };
}

export function registerSellerIdentityRoutes(server: MCPServer) {
  server.get("/api/seller-auth-config", c => c.json({ provider: "google", insforge_url: env().INSFORGE_BASE_URL ?? null,
    callback_url: "http://127.0.0.1:43118/auth/callback" }));
  server.use("/api/seller/identity", bodyLimit({ maxSize: 16384 }));
  server.post("/api/seller/identity", async c => {
    c.header("Cache-Control", "no-store");
    try {
      const token = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? "";
      const owner = await verifyGoogleUser(token);
      const input = z.object({ agent_key: z.string().regex(/^atm_sk_[A-Za-z0-9_-]{43}$/), display_name: z.string().min(1).max(80) }).parse(await c.req.json());
      return c.json(await linkSellerIdentity(owner, input.agent_key, input.display_name));
    } catch (error) {
      const code = error instanceof Error ? error.message : "SELLER_LINK_FAILED";
      if (code === "GOOGLE_SIGN_IN_REQUIRED") return c.json({ error: code }, 401);
      if (code === "SELLER_BELONGS_TO_ANOTHER_ACCOUNT") return c.json({ error: code }, 409);
      return c.json({ error: "SELLER_LINK_FAILED" }, 400);
    }
  });
}
