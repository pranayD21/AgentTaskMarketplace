import { createAdminClient } from "@insforge/sdk";
import { MarketplaceError, type AgentKind, type Envelope, type ModelInfo, type SellerStatus, type TaskStatus } from "@atm/shared";
import { env } from "./env.js";

// ---------------------------------------------------------------------------
// Row types (snake_case mirrors db/schema.sql)
// ---------------------------------------------------------------------------

export interface AgentRow {
  id: string;
  kind: AgentKind;
  display_name: string;
  api_key_hash: string;
  inkbox_handle: string | null;
  inkbox_identity_id: string | null;
  buyer_pubkey_b64: string | null;
  buyer_key_id: string | null;
  buyer_secret_enc: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  stripe_account_id: string | null;
  spend_cap_cents: number;
  reserved_cents: number;
  spent_cents: number;
  created_at: string;
}

export interface SellerRow {
  agent_id: string;
  status: SellerStatus;
  models: ModelInfo[];
  runner_pubkey_b64: string | null;
  runner_key_id: string | null;
  runner_wasm_sha256: string | null;
  runtime: "wassette" | "node-unsandboxed";
  wassette_version: string | null;
  approvals: number;
  rejections: number;
  strikes: number;
  last_seen: string;
}

export interface TaskRow {
  id: string;
  buyer_id: string;
  allowed_models: string[];
  max_price_cents: number;
  max_runtime_s: number;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
  plaintext_enc_server: string | null;
  payload_enc_judge: Envelope | null;
  payload_enc_seller: Envelope | null;
  claim_id: string | null;
  seller_id: string | null;
  model_id: string | null;
  price_cents: number | null;
  lease_expires_at: string | null;
  claim_count: number;
  judge_id: string | null;
  payment_mode: "card" | "mpp" | "mock";
  payment_state: string;
  stripe_payment_intent_id: string | null;
  payment_link: string | null;
  inkbox_context_id: string | null;
}

export interface ResultRow {
  id: string;
  task_id: string;
  claim_id: string;
  seller_id: string;
  model_id: string;
  result_enc_buyer: Envelope;
  result_enc_judge: Envelope;
  commitment_sha256: string;
  runtime_ms: number;
  tokens_out: number | null;
  created_at: string;
}

export interface VerdictRow {
  id: string;
  task_id: string;
  result_id: string;
  judge_id: string;
  verdict: "APPROVE" | "REJECT";
  reason_code: string;
  reason_public: string;
  score: number | null;
  replacement_enc_buyer: Envelope | null;
  created_at: string;
}

export interface SettlementRow {
  id: string;
  task_id: string;
  kind: string;
  state: string;
  seller_payout_cents: number;
  buyer_refund_cents: number;
  stripe_capture_id: string | null;
  stripe_transfer_id: string | null;
  note: string | null;
  created_at: string;
}

export interface EventRow {
  id: number;
  task_id: string | null;
  agent_id: string | null;
  type: string;
  meta: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>;
let admin: Admin | undefined;

export function db(): Admin["database"] {
  if (!admin) {
    admin = createAdminClient({ baseUrl: env().INSFORGE_BASE_URL, apiKey: env().INSFORGE_API_KEY });
  }
  return admin.database;
}

function describe(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    return [e.code, e.message, e.details].filter(Boolean).join(" ");
  }
  return String(err);
}

/** Unwrap a PostgREST-style `{ data, error }` response; throws MarketplaceError on error. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw new MarketplaceError("INTERNAL_ERROR", `database: ${describe(res.error)}`, { retryable: true });
  return res.data as T;
}

export async function one<T>(res: { data: T[] | null; error: unknown }): Promise<T | null> {
  const rows = unwrap(res);
  return rows?.[0] ?? null;
}

/** Admin raw SQL through Insforge; used only for aggregates the query builder cannot express. */
export async function rawSql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(`${env().INSFORGE_BASE_URL}/api/database/advance/rawsql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env().INSFORGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new MarketplaceError("INTERNAL_ERROR", `rawsql HTTP ${res.status}`, { retryable: true });
  const body = (await res.json()) as { rows?: T[] };
  return body.rows ?? [];
}

export async function logEvent(type: string, fields: { task_id?: string | null; agent_id?: string | null; meta?: Record<string, unknown> }): Promise<void> {
  try {
    unwrap(await db().from("events").insert({ type, task_id: fields.task_id ?? null, agent_id: fields.agent_id ?? null, meta: fields.meta ?? {} }));
  } catch (err) {
    console.error("[events] failed to log", type, (err as Error).message);
  }
}
