import { createAdminClient } from "@insforge/sdk";
import { MarketplaceError, type AgentKind, type Envelope, type ModelInfo, type SellerStatus, type TaskStatus } from "@atm/shared";
import { env } from "./env.js";
import { memoryDb } from "./memdb.js";
import { PREPARE_TASK_SQL } from "./prepare-task-sql.js";
import type { HoldResult } from "./payments.js";

// ---------------------------------------------------------------------------
// Row types (snake_case mirrors db/schema.sql)
// ---------------------------------------------------------------------------

export interface AgentRow {
  owner_user_id?: string | null;
  owner_email?: string | null;
  stripe_onboarding_started_at?: string | null;
  stripe_onboarding_attempts?: number;
  stripe_onboarding_retry_at?: string | null;
  balance_keys?: string[] | null;
  balance_revision?: number;
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
  last_claim_key_id: string | null;
  last_claim_pubkey_b64: string | null;
  runner_wasm_sha256: string | null;
  runtime: "wassette" | "node-unsandboxed";
  wassette_version: string | null;
  approvals: number;
  rejections: number;
  strikes: number;
  /** Set when an operator lifts a suspension; only rejections after it count as strikes. */
  reinstated_at?: string | null;
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
  pricing_mode?: string | null;
  post_state?: string | null;
  post_hold?: HoldResult | null;
  lease_expires_at: string | null;
  claim_runner_key_id: string | null;
  claim_runner_pubkey_b64: string | null;
  review_status?: string | null;
  review_attempts?: number | null;
  review_retry_at?: string | null;
  replacement_status?: string | null;
  replacement_attempts?: number | null;
  replacement_retry_at?: string | null;
  settle_pending?: boolean | null;
  job_id?: string | null;
  part_key?: string | null;
  part_label?: string | null;
  attempt?: number | null;
  client_request_id?: string | null;
  inkbox_thread_owner?: string | null;
  inkbox_buyer_context_id?: string | null;
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
  seller_id?: string | null;
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
  // v0.3 §9
  outcome?: "APPROVE" | "REJECT" | "CANCEL" | "EXPIRE" | null;
  result_id?: string | null;
  verdict_reason_code?: string | null;
  decision?: SettlementDecision | null;
  payment_state?: string | null;
  finalized_at?: string | null;
  updated_at?: string | null;
  payout_owed_cents?: number | null;
  payout_transferred_cents?: number | null;
  transfer_state?: "NOT_APPLICABLE" | "PENDING" | "TRANSFERRED" | null;
  transfer_attempts?: number | null;
  transfer_retry_at?: string | null;
  transfer_lease_token?: string | null;
  transfer_lease_until?: string | null;
  transfer_key_attempt?: number | null;
  transfer_key_created_at?: string | null;
  transfer_retry_safe_to_advance?: boolean | null;
  transfer_manual_review?: boolean | null;
  transfer_pending_reason?: string | null;
}

/** What a settlement intent remembers so any later call can finish it the same way. */
export interface SettlementDecision {
  judge_id?: string | null;
  score?: number | null;
  replacement_enc_buyer?: Envelope | null;
  /** Task payment_state when the decision was recorded. */
  prior_payment_state: string;
  /** Buyer reservation to give back (0 when none was taken, e.g. an unpaid mpp task). */
  release_reserved_cents: number;
  /** Reason passed to the payment provider when the hold is released. */
  release_reason?: string | null;
}

export interface JobRow {
  id: string;
  buyer_id: string;
  label_public: string | null;
  budget_cents: number;
  reserved_cents: number;
  spent_cents: number;
  balance_keys: string[] | null;
  client_job_key: string | null;
  balance_revision?: number;
  created_at: string;
  updated_at: string;
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
  // The memory store implements the subset of the PostgREST builder used here.
  if (env().DB_MODE === "memory") return memoryDb() as unknown as Admin["database"];
  if (!admin) {
    admin = createAdminClient({ baseUrl: env().INSFORGE_BASE_URL!, apiKey: env().INSFORGE_API_KEY! });
  }
  return admin.database;
}

export function dbLabel(): string {
  return env().DB_MODE === "memory" ? "MEMORY — in-process tables, dev/test only, lost on restart" : "Insforge Postgres";
}

/**
 * Columns added after the first schema push (contract v0.2). Mirrors the
 * `alter table … add column if not exists` lines at the end of db/schema.sql
 * so a server started from main brings an older database up to date without
 * anyone remembering to run scripts/db-migrate.sh.
 */
export const SCHEMA_PATCHES = [
  "create table if not exists provider_budget (id text primary key, revision integer not null default 0, cap_microusd integer not null default 0, entries jsonb not null default '{}'::jsonb)",
  "alter table provider_budget enable row level security",
  // Agent credentials and human ownership are server-only. Public projections
  // are served through MCP; no browser receives direct access to this table.
  "alter table agents enable row level security",
  "alter table agents add column if not exists owner_user_id uuid references auth.users(id)",
  "alter table agents add column if not exists owner_email text",
  "alter table agents add column if not exists stripe_onboarding_started_at timestamptz",
  "alter table agents add column if not exists stripe_onboarding_attempts integer not null default 0",
  "alter table agents add column if not exists stripe_onboarding_retry_at timestamptz",
  "alter table sellers add column if not exists reinstated_at timestamptz",
  "alter table tasks add column if not exists pricing_mode text",
  "alter table tasks add column if not exists post_state text",
  "alter table tasks add column if not exists post_hold jsonb",
  "alter table agents add column if not exists balance_revision integer not null default 0",
  // v0.2
  "alter table tasks add column if not exists claim_runner_key_id text",
  "alter table tasks add column if not exists claim_runner_pubkey_b64 text",
  "alter table sellers add column if not exists last_claim_key_id text",
  "alter table sellers add column if not exists last_claim_pubkey_b64 text",
  // v0.3 §8
  "alter table tasks add column if not exists review_status text",
  "alter table tasks add column if not exists review_attempts integer not null default 0",
  "alter table tasks add column if not exists review_retry_at timestamptz",
  "alter table tasks add column if not exists replacement_status text",
  "alter table tasks add column if not exists replacement_attempts integer not null default 0",
  "alter table tasks add column if not exists replacement_retry_at timestamptz",
  // v0.3 §9
  "alter table tasks add column if not exists settle_pending boolean not null default false",
  "alter table verdicts add column if not exists seller_id text",
  "alter table settlements add column if not exists outcome text",
  "alter table settlements add column if not exists result_id text",
  "alter table settlements add column if not exists verdict_reason_code text",
  "alter table settlements add column if not exists decision jsonb",
  "alter table settlements add column if not exists payment_state text",
  "alter table settlements add column if not exists finalized_at timestamptz",
  "alter table settlements add column if not exists updated_at timestamptz",
  "alter table settlements add column if not exists payout_owed_cents integer",
  "alter table settlements add column if not exists payout_transferred_cents integer",
  "alter table settlements add column if not exists transfer_state text",
  "alter table settlements add column if not exists transfer_attempts integer not null default 0",
  "alter table settlements add column if not exists transfer_retry_at timestamptz",
  "alter table settlements add column if not exists transfer_lease_token text",
  "alter table settlements add column if not exists transfer_lease_until timestamptz",
  "alter table settlements add column if not exists transfer_key_attempt integer not null default 0",
  "alter table settlements add column if not exists transfer_key_created_at timestamptz",
  "alter table settlements add column if not exists transfer_retry_safe_to_advance boolean not null default false",
  "alter table settlements add column if not exists transfer_manual_review boolean not null default false",
  "alter table settlements add column if not exists transfer_pending_reason text",
  "alter table agents add column if not exists balance_keys text[] not null default '{}'",
  // v0.3 §10
  "create table if not exists jobs (id text primary key, buyer_id text not null references agents(id), label_public text, budget_cents integer not null, reserved_cents integer not null default 0, spent_cents integer not null default 0, balance_keys text[] not null default '{}', client_job_key text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
  "create index if not exists jobs_buyer_idx on jobs(buyer_id)",
  "alter table tasks add column if not exists job_id text",
  "alter table tasks add column if not exists part_key text",
  "alter table tasks add column if not exists part_label text",
  "alter table tasks add column if not exists attempt integer",
  "alter table tasks add column if not exists client_request_id text",
  "create index if not exists tasks_job_idx on tasks(job_id)",
  "create unique index if not exists tasks_job_part_attempt_uniq on tasks(job_id, part_key, attempt)",
  "create unique index if not exists tasks_buyer_request_uniq on tasks(buyer_id, client_request_id)",
  "create unique index if not exists jobs_buyer_key_uniq on jobs(buyer_id, client_job_key)",
  "alter table jobs add column if not exists balance_revision integer not null default 0",
  PREPARE_TASK_SQL,
  "revoke all on function atm_prepare_task(jsonb) from public",
  // v0.3 §12
  "alter table tasks add column if not exists inkbox_thread_owner text",
  "alter table tasks add column if not exists inkbox_buyer_context_id text",
  // Backfills for rows written before v0.3 (each is a no-op once applied).
  // Pre-v0.3 settlements were written after their money moved and were never resumed.
  "update settlements set finalized_at = created_at, payment_state = coalesce(payment_state, 'LEGACY') where finalized_at is null and outcome is null",
  "update settlements set payout_owed_cents = seller_payout_cents, payout_transferred_cents = case when stripe_transfer_id is not null then seller_payout_cents else 0 end, transfer_state = case when seller_payout_cents = 0 then 'NOT_APPLICABLE' when stripe_transfer_id is not null then 'TRANSFERRED' else 'PENDING' end where transfer_state is null",
  "update verdicts v set seller_id = r.seller_id from results r where v.result_id = r.id and v.seller_id is null",
  "update tasks set review_status = 'FINAL' where review_status is null and status in ('APPROVED','REJECTED')",
  "update tasks set replacement_status = 'NOT_NEEDED' where replacement_status is null and status = 'APPROVED'",
  "update tasks t set replacement_status = case when exists (select 1 from verdicts v where v.task_id = t.id and v.replacement_enc_buyer is not null) then 'DELIVERED' else 'UNAVAILABLE' end where t.replacement_status is null and t.status = 'REJECTED'",
];

let schemaReady: Promise<void> | undefined;
let schemaFailedAt = 0;

/**
 * Apply SCHEMA_PATCHES once per process, lazily on the first authenticated
 * tool call or sweep (not at import, so `mcp-use build` never touches the
 * database). Never throws; a failure is logged and retried after 30 s.
 */
export function ensureSchema(): Promise<void> {
  if (env().DB_MODE === "memory") return Promise.resolve();
  if (!schemaReady && Date.now() - schemaFailedAt > 30_000) {
    // One statement per request, so a statement Insforge rejects cannot block the rest.
    schemaReady = (async () => {
      const failed: number[] = [];
      for (const [i, stmt] of SCHEMA_PATCHES.entries()) {
        try {
          await rawSql(stmt);
        } catch {
          failed.push(i);
        }
      }
      if (failed.length) {
        schemaFailedAt = Date.now();
        schemaReady = undefined;
        console.error(`[db] ${failed.length} schema patch(es) failed (indexes ${failed.join(",")}); will retry`);
      }
    })();
  }
  return schemaReady ?? Promise.resolve();
}

const BALANCE_CAS_ATTEMPTS = 8;

export interface BalanceDelta {
  reserved?: number;
  spent?: number;
}

export interface BalanceOpts {
  /** Refuse (write nothing) when reserved + spent would exceed the cap. */
  enforceCap?: boolean;
  /**
   * Exactly-once key (contract §9), e.g. `settle:<task_id>`. Recorded in the row's
   * balance_keys in the same write; a key already present makes the call a no-op.
   */
  key?: string;
}

type CounterRow = { reserved_cents: number; spent_cents: number; balance_keys?: string[] | null; balance_revision?: number };

async function adjustCounters<R extends CounterRow>(
  table: "agents" | "jobs",
  id: string,
  capOf: (row: R) => number,
  delta: BalanceDelta,
  opts: BalanceOpts,
): Promise<{ row: R | null; refused: boolean; applied: boolean }> {
  for (let attempt = 0; attempt < BALANCE_CAS_ATTEMPTS; attempt++) {
    const cur = await one<R>(await db().from(table).select("*").eq("id", id).limit(1));
    if (!cur) return { row: null, refused: false, applied: false };
    const keys = cur.balance_keys ?? [];
    if (opts.key && keys.includes(opts.key)) return { row: cur, refused: false, applied: false };
    const reserved = Math.max(0, cur.reserved_cents + (delta.reserved ?? 0));
    const spent = Math.max(0, cur.spent_cents + (delta.spent ?? 0));
    if (opts.enforceCap && reserved + spent > capOf(cur)) return { row: cur, refused: true, applied: false };
    const rows = unwrap(
      await db()
        .from(table)
        .update({ reserved_cents: reserved, spent_cents: spent, balance_revision: (cur.balance_revision ?? 0) + 1, ...(opts.key ? { balance_keys: [...keys, opts.key] } : {}) })
        .eq("id", id)
        .eq("reserved_cents", cur.reserved_cents)
        .eq("spent_cents", cur.spent_cents)
        .eq("balance_revision", cur.balance_revision ?? 0)
        .select(),
    ) as R[];
    if (rows.length) return { row: rows[0]!, refused: false, applied: true };
  }
  throw new MarketplaceError("INTERNAL_ERROR", `${table === "agents" ? "Buyer balance" : "Job budget"} kept changing under concurrent calls.`, { retryable: true });
}

/**
 * Change a buyer's reserved/spent counters by compare-and-swap, so concurrent
 * tool calls cannot lose an update or jointly overshoot the cap. With
 * `enforceCap`, nothing is written and `refused` is true when reserved + spent
 * would exceed spend_cap_cents; `buyer` is then the row that was checked.
 */
export async function adjustBuyerBalance(buyerId: string, delta: BalanceDelta, opts: BalanceOpts = {}): Promise<{ buyer: AgentRow | null; refused: boolean; applied: boolean }> {
  const r = await adjustCounters<AgentRow>("agents", buyerId, (a) => a.spend_cap_cents, delta, opts);
  return { buyer: r.row, refused: r.refused, applied: r.applied };
}

/** The same compare-and-swap for a job's budget (contract §10). */
export async function adjustJobBudget(jobId: string, delta: BalanceDelta, opts: BalanceOpts = {}): Promise<{ job: JobRow | null; refused: boolean; applied: boolean }> {
  const r = await adjustCounters<JobRow>("jobs", jobId, (j) => j.budget_cents, delta, opts);
  return { job: r.row, refused: r.refused, applied: r.applied };
}

/** Task counts per status for the dashboard. */
export async function countTasksByStatus(): Promise<Record<string, number>> {
  if (env().DB_MODE === "memory") {
    const counts: Record<string, number> = {};
    for (const t of memoryDb().rows("tasks")) counts[t.status as string] = (counts[t.status as string] ?? 0) + 1;
    return counts;
  }
  const rows = await rawSql<{ status: string; n: number }>("select status, count(*)::int as n from tasks group by status");
  return Object.fromEntries(rows.map((c) => [c.status, c.n]));
}

function describe(err: unknown): string {
  if (err && typeof err === "object") {
    // `details` is left out on purpose: Postgres puts the failing row's values there.
    const e = err as { message?: string; code?: string; hint?: string };
    return [e.code, e.message, e.hint].filter(Boolean).join(" ");
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
  if (env().DB_MODE === "memory") throw new MarketplaceError("INTERNAL_ERROR", "raw SQL is not available with DB_MODE=memory");
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

/** Task insert and cap reservation commit together, before any provider call. */
export async function prepareTask(row: Record<string, unknown>): Promise<TaskRow> {
  let result: { task?: TaskRow; error?: string };
  if (env().DB_MODE === "memory") result = unwrap(memoryDb().prepareTask(row)) as typeof result;
  else {
    await ensureSchema();
    const json = JSON.stringify(row).replace(/'/g, "''");
    const rows = await rawSql<{ result: typeof result }>(`select atm_prepare_task('${json}'::jsonb) as result`);
    result = rows[0]!.result;
  }
  if (result.error) {
    const code = result.error === "SPEND_CAP_EXCEEDED" || result.error === "JOB_BUDGET_EXCEEDED" ? result.error : "NOT_FOUND";
    throw new MarketplaceError(code, "The task could not reserve its offer within the buyer and job budgets.", { next_action: "Inspect whoami and get_job. Lower the offer or wait for existing tasks to settle; do not raise a cap without human approval." });
  }
  if (!result.task) throw new MarketplaceError("INTERNAL_ERROR", "No task was returned by the posting transaction.", { retryable: true });
  return result.task;
}
