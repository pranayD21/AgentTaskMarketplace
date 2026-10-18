/**
 * Marketplace domain logic. Tools in tools.ts are thin wrappers over these
 * functions so the state machine lives in one place.
 */
import {
  commitment,
  fromUtf8,
  generateKeypair,
  keyIdFor,
  keypairFromSecretB64,
  open,
  publicKeyFromB64,
  sealJson,
  toB64,
} from "@atm/crypto";
import {
  ACTIVE_CLAIM_STATUSES,
  DEFAULT_LISTING_TTL_SECONDS,
  DEFAULT_MAX_RUNTIME_SECONDS,
  Envelope,
  LEASE_SECONDS,
  MAX_PRICE_CENTS,
  MODEL_ALLOWLIST,
  APPROVE_REASON_CODES,
  CLIENT_REQUEST_ID_PATTERN,
  MarketplaceError,
  PART_KEY_PATTERN,
  ModelInfo,
  REJECT_REASON_CODES,
  Rubric,
  isAllowlistedModel,
  isInfraReason,
  publicReason,
  isPast,
  nowIso,
  plusSecondsIso,
  type AgentKind,
  type ClaimPublicV02,
  type JudgePayload,
  type KeyDescriptor,
  type JobProgress,
  type JobPublic,
  type JobStatus,
  type ResultPlaintext,
  type RunnerKeySource,
  type SellerPayload,
  type SellerPublic,
  type TaskPublic,
  type TaskStatus,
  type Verdict,
  type VerdictReasonCode,
} from "@atm/shared";
import { hashApiKey } from "./auth.js";
import { countTasksByStatus, db, dbLabel, ensureSchema, prepareTask, type JobRow, logEvent, one, unwrap, type AgentRow, type ResultRow, type SellerRow, type SettlementRow, type TaskRow, type VerdictRow } from "./db.js";
import { env } from "./env.js";
import { newApiKey, newId } from "./ids.js";
import { inkbox } from "./inkbox.js";
import { kekOpen, kekSeal } from "./kek.js";
import { notifyTask } from "./notices.js";
import { payments, sellerPayoutInfo } from "./payments.js";
import { ensureHumanPayoutAccount } from "./seller-identity.js";
import { cancelPosting, finishPost, resumePosts } from "./posting.js";
import { deferReview, reviewDue, reviewOf } from "./review.js";
import { RESUME_AFTER_S, finalizeSettlement, outcomeForStatus, recordIntent, retryPendingTransfers, settlementOf } from "./settlement.js";

const JUDGING_TIMEOUT_S = 10 * 60;

interface ServerPlaintext {
  prompt: string;
  context?: string;
  rubric: Rubric;
  max_tokens: number;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export async function getAgent(id: string): Promise<AgentRow | null> {
  return one<AgentRow>(await db().from("agents").select("*").eq("id", id).limit(1));
}

export async function getSeller(agentId: string): Promise<SellerRow | null> {
  return one<SellerRow>(await db().from("sellers").select("*").eq("agent_id", agentId).limit(1));
}

export async function getTask(id: string): Promise<TaskRow | null> {
  return one<TaskRow>(await db().from("tasks").select("*").eq("id", id).limit(1));
}

async function mustGetTask(id: string): Promise<TaskRow> {
  const t = await getTask(id);
  if (!t) throw new MarketplaceError("NOT_FOUND", `Unknown task ${id}.`, { next_action: "Check the task_id (list_my_tasks for buyers, list_open_tasks for sellers)." });
  return t;
}

async function latestResult(taskId: string): Promise<ResultRow | null> {
  return one<ResultRow>(await db().from("results").select("*").eq("task_id", taskId).order("created_at", { ascending: false }).limit(1));
}

async function latestVerdict(taskId: string): Promise<VerdictRow | null> {
  return one<VerdictRow>(await db().from("verdicts").select("*").eq("task_id", taskId).order("created_at", { ascending: false }).limit(1));
}

async function settlementFor(taskId: string): Promise<SettlementRow | null> {
  return one<SettlementRow>(await db().from("settlements").select("*").eq("task_id", taskId).limit(1));
}

function judgeKey(): KeyDescriptor {
  return { key_id: env().JUDGE_KEY_ID, public_key_b64: env().JUDGE_PUBLIC_KEY_B64 };
}

// ---------------------------------------------------------------------------
// Public projections
// ---------------------------------------------------------------------------

export function toTaskPublic(t: TaskRow): TaskPublic {
  return {
    task_id: t.id,
    buyer_id: t.buyer_id,
    allowed_models: t.allowed_models,
    max_price_cents: t.max_price_cents,
    max_runtime_s: t.max_runtime_s,
    status: t.status,
    created_at: t.created_at,
    expires_at: t.expires_at,
    claim_id: t.claim_id,
    seller_id: t.seller_id,
    model_id: t.model_id,
    price_cents: t.price_cents ?? (["OPEN", "AWAITING_PAYMENT"].includes(t.status) ? t.max_price_cents : null),
    lease_expires_at: t.lease_expires_at,
    payment: {
      mode: t.payment_mode,
      state: t.payment_state,
      stripe_payment_intent_id: t.stripe_payment_intent_id,
      payment_link: t.payment_link,
    },
    inkbox_context_id: t.inkbox_context_id,
    review: reviewOf(t),
    replacement_status: replacementStatusOf(t),
    job_id: t.job_id ?? null,
    part_key: t.part_key ?? null,
    part_label: t.part_label ?? null,
    attempt: t.attempt ?? null,
  };
}

function replacementStatusOf(t: TaskRow): TaskPublic["replacement_status"] {
  if (t.replacement_status) return t.replacement_status as TaskPublic["replacement_status"];
  return t.status === "APPROVED" ? "NOT_NEEDED" : null;
}

/** Verdict fields safe to show anyone who may see the task (contract §8.1): the reason text comes from the code. */
export function publicVerdict(v: VerdictRow) {
  return { verdict_id: v.id, task_id: v.task_id, result_id: v.result_id, verdict: v.verdict, reason_code: v.reason_code, reason_public: publicReason(v.reason_code), score: v.score, created_at: v.created_at };
}

/** Settlement without its internal decision record (which carries judge ids and buyer ciphertext). */
export function publicSettlement(s: SettlementRow) {
  const { decision: _d, ...rest } = s;
  return rest;
}

export function toSellerPublic(s: SellerRow, a: AgentRow): SellerPublic {
  const registered = s.runner_key_id && s.runner_pubkey_b64 ? { key_id: s.runner_key_id, public_key_b64: s.runner_pubkey_b64 } : null;
  const perClaim = s.last_claim_key_id && s.last_claim_pubkey_b64 ? { key_id: s.last_claim_key_id, public_key_b64: s.last_claim_pubkey_b64 } : null;
  return {
    seller_id: a.id,
    display_name: a.display_name,
    status: s.status,
    models: s.models,
    runner: {
      public_key: registered ?? perClaim ?? { key_id: "none", public_key_b64: "" },
      key_source: registered ? "registered" : perClaim ? "per-claim" : "none",
      wasm_sha256: s.runner_wasm_sha256,
      runtime: s.runtime,
      wassette_version: s.wassette_version,
    },
    reputation: { approvals: s.approvals, rejections: s.rejections, strikes: s.strikes },
    inkbox_handle: a.inkbox_handle,
    last_seen: s.last_seen,
  };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface RegisterAgentInput {
  kind: AgentKind;
  display_name: string;
  spend_cap_cents?: number;
  judge_secret?: string;
}

export async function registerAgent(input: RegisterAgentInput): Promise<{ agent: AgentRow; api_key: string; notes: string[] }> {
  if (input.kind === "seller" && env().DB_MODE === "insforge") throw new MarketplaceError("FORBIDDEN", "New sellers require human Google sign-in.", { next_action: `Install the seller dashboard from ${env().baseUrl}/install.sh and sign in with Google.` });
  if (input.kind === "judge" && input.judge_secret !== env().JUDGE_REGISTRATION_SECRET) {
    throw new MarketplaceError("FORBIDDEN", "Judge registration requires the operator's JUDGE_REGISTRATION_SECRET.", {
      next_action: "Pass judge_secret from the operator, or register as kind='buyer' or kind='seller'.",
    });
  }
  const id = newId(input.kind);
  const api_key = newApiKey();
  const notes: string[] = [];
  const row: Record<string, unknown> = {
    id,
    kind: input.kind,
    display_name: input.display_name,
    api_key_hash: hashApiKey(api_key),
    spend_cap_cents: 0,
    reserved_cents: 0,
    spent_cents: 0,
  };

  if (input.kind === "buyer") {
    const kp = generateKeypair();
    row.buyer_pubkey_b64 = toB64(kp.publicKey);
    row.buyer_key_id = `buyer-${keyIdFor(kp.publicKey)}`;
    row.buyer_secret_enc = kekSeal(toB64(kp.secretKey));
    row.spend_cap_cents = input.spend_cap_cents ?? env().DEFAULT_SPEND_CAP_CENTS;
    Object.assign(row, await payments().onboardBuyer({ id, display_name: input.display_name }));
    notes.push(`Spend cap ${row.spend_cap_cents}c per buyer; payments: ${payments().label}.`);
    notes.push("The marketplace holds this buyer's result-decryption key so hosted clients can read answers via get_result.");
  }
  if (input.kind === "seller") {
    Object.assign(row, await payments().onboardSeller({ id, display_name: input.display_name }));
    if (!row.stripe_account_id && payments().mode === "card") notes.push("No Stripe connected account could be created; payouts will be recorded as PENDING_ONBOARDING.");
  }

  const ink = await inkbox.createIdentity(`atm-${id.replace(/_/g, "-")}`, input.display_name);
  if (ink) {
    row.inkbox_handle = ink.handle;
    row.inkbox_identity_id = ink.identity_id;
  } else if (!inkbox.enabled) {
    notes.push("Inkbox identity not created (INKBOX_API_KEY not configured).");
  }

  const inserted = unwrap(await db().from("agents").insert(row).select());
  const agent = (inserted as AgentRow[])[0]!;
  if (input.kind === "seller") {
    unwrap(await db().from("sellers").insert({ agent_id: id }));
  }
  await logEvent("agent.registered", { agent_id: id, meta: { kind: input.kind, display_name: input.display_name } });
  return { agent, api_key, notes };
}

/** Validate a runner public key (32-byte X25519, base64) and derive its id when none is given. */
function runnerKey(pubB64: string, keyId?: string): KeyDescriptor {
  let pub: Uint8Array;
  try {
    pub = publicKeyFromB64(pubB64);
  } catch (err) {
    throw new MarketplaceError("VALIDATION_ERROR", `runner_pubkey_b64 is not an X25519 public key: ${(err as Error).message}.`, {
      next_action: "Send the base64 of the 32-byte public key generated inside the runner sandbox (the runner's get-public-key output).",
    });
  }
  // A runner sealed to the judge's key would let that seller host read judge copies.
  if (toB64(pub) === env().JUDGE_PUBLIC_KEY_B64) {
    throw new MarketplaceError("VALIDATION_ERROR", "runner_pubkey_b64 is the judge's public key; a seller runner must use its own key.", {
      next_action: "Generate a fresh key inside the runner sandbox. Do not give a seller daemon JUDGE_PRIVATE_KEY_B64.",
    });
  }
  return { key_id: keyId?.trim() || `runner-${keyIdFor(pub)}`, public_key_b64: toB64(pub) };
}

export interface RegisterSellerInput {
  models: ModelInfo[];
  /** Optional since v0.2: without it every claim_task must carry a per-claim key. */
  runner_pubkey_b64?: string;
  runner_key_id?: string;
  runner_wasm_sha256?: string;
  runtime: "wassette" | "node-unsandboxed";
  wassette_version?: string;
}

export async function registerSeller(agent: AgentRow, input: RegisterSellerInput): Promise<SellerPublic> {
  if (agent.owner_user_id) agent = await ensureHumanPayoutAccount(agent);
  const unknown = input.models.filter((m) => !isAllowlistedModel(m.model_id)).map((m) => m.model_id);
  if (unknown.length) {
    throw new MarketplaceError("MODEL_NOT_ALLOWED", `Models not on the allowlist: ${unknown.join(", ")}.`, {
      next_action: `Advertise only allowlisted models: ${Object.keys(MODEL_ALLOWLIST).join(", ")}.`,
    });
  }
  if (input.runner_key_id && !input.runner_pubkey_b64) {
    throw new MarketplaceError("VALIDATION_ERROR", "runner_key_id was sent without runner_pubkey_b64.", {
      next_action: "Send both, or neither and present runner_pubkey_b64 on every claim_task instead.",
    });
  }
  const key = input.runner_pubkey_b64 ? runnerKey(input.runner_pubkey_b64, input.runner_key_id) : null;
  const patch = {
    models: input.models.map(({ ask_cents: _ignored, ...capability }) => capability),
    runner_pubkey_b64: key?.public_key_b64 ?? null,
    runner_key_id: key?.key_id ?? null,
    runner_wasm_sha256: input.runner_wasm_sha256 ?? null,
    runtime: input.runtime,
    wassette_version: input.wassette_version ?? null,
    last_seen: nowIso(),
  };
  let rows = unwrap(await db().from("sellers").update(patch).eq("agent_id", agent.id).select()) as SellerRow[];
  if (!rows.length) rows = unwrap(await db().from("sellers").insert({ agent_id: agent.id, ...patch }).select()) as SellerRow[];
  await logEvent("seller.registered", { agent_id: agent.id, meta: { models: input.models.map((m) => m.model_id), runtime: input.runtime, key_mode: key ? "registered" : "per-claim" } });
  return toSellerPublic(rows[0]!, agent);
}

// ---------------------------------------------------------------------------
// Buyer: post / list / read / cancel
// ---------------------------------------------------------------------------

export interface PostTaskInput {
  prompt: string;
  context?: string;
  allowed_models: string[];
  price_cents?: number;
  max_price_cents?: number;
  max_runtime_s?: number;
  expires_in_s?: number;
  rubric: Rubric;
  max_tokens?: number;
  // v0.3 §10: parts of a job, and idempotent posting
  job_id?: string;
  part_key?: string;
  part_label?: string;
  client_request_id?: string;
}

/** Resolve the posted offer before reserving budgets or placing a hold. */
export function taskOffer(input: Pick<PostTaskInput, "price_cents" | "max_price_cents">): number {
  const { price_cents: price, max_price_cents: alias } = input;
  if (price !== undefined && alias !== undefined && price !== alias) {
    throw new MarketplaceError("VALIDATION_ERROR", "price_cents and max_price_cents disagree.", { next_action: "Send price_cents alone, or the same value for both fields." });
  }
  const offer = price ?? alias;
  if (!Number.isSafeInteger(offer) || offer! < payments().min_cents || offer! > MAX_PRICE_CENTS) {
    throw new MarketplaceError("VALIDATION_ERROR", `price_cents must be an integer from ${payments().min_cents} to ${MAX_PRICE_CENTS}.`, { next_action: "Choose a posted price within your available buyer and job budgets." });
  }
  return offer!;
}

/** A part whose latest attempt ended like this may be posted again as a new attempt. */
const FAILED_ATTEMPT_STATUSES: readonly TaskStatus[] = ["REJECTED", "EXPIRED", "CANCELLED"];

async function latestAttempt(jobId: string, partKey: string): Promise<TaskRow | null> {
  return one<TaskRow>(await db().from("tasks").select("*").eq("job_id", jobId).eq("part_key", partKey).order("attempt", { ascending: false }).limit(1));
}

/** The task an earlier, possibly unanswered post already created (contract §10). */
async function existingPost(buyer: AgentRow, input: PostTaskInput): Promise<TaskRow | null> {
  if (input.client_request_id) {
    const t = await one<TaskRow>(await db().from("tasks").select("*").eq("buyer_id", buyer.id).eq("client_request_id", input.client_request_id).limit(1));
    if (t) return t;
  }
  if (input.job_id && input.part_key) {
    const latest = await latestAttempt(input.job_id, input.part_key);
    if (latest && !FAILED_ATTEMPT_STATUSES.includes(latest.status)) return latest;
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof MarketplaceError && /\b23505\b|duplicate key/.test(err.message);
}

function validatePostKeys(input: PostTaskInput): void {
  const bad = (msg: string, next: string) => new MarketplaceError("VALIDATION_ERROR", msg, { next_action: next });
  if ((input.job_id == null) !== (input.part_key == null)) throw bad("job_id and part_key go together.", "Send both to post a part of a job (create_job first), or neither for a standalone task.");
  if (input.part_key != null && !PART_KEY_PATTERN.test(input.part_key)) throw bad("part_key must match [A-Za-z0-9._-]{1,64}.", "Use a short stable id such as part-1; it is public.");
  if (input.part_label != null && input.job_id == null) throw bad("part_label needs a job_id.", "Drop part_label, or post the task as part of a job.");
  if (input.client_request_id != null && !CLIENT_REQUEST_ID_PATTERN.test(input.client_request_id)) {
    throw bad("client_request_id must match [A-Za-z0-9._-]{8,64}.", "Generate one random id per intended task and reuse it when retrying the same post.");
  }
}

export async function postTask(buyer: AgentRow, raw: PostTaskInput): Promise<{ task: TaskPublic; idempotent: boolean; payment_note: string; payment_label: string }> {
  const offer = taskOffer(raw);
  const input = { ...raw, max_price_cents: offer };
  validatePostKeys(input);
  let job: JobRow | null = null;
  if (input.job_id) {
    job = await one<JobRow>(await db().from("jobs").select("*").eq("id", input.job_id).limit(1));
    if (!job || job.buyer_id !== buyer.id) throw new MarketplaceError("NOT_FOUND", `Unknown job ${input.job_id}.`, { next_action: "Call list_my_jobs, or create_job first." });
  }
  const repeat = await existingPost(buyer, input);
  if (repeat) return { task: toTaskPublic(repeat), idempotent: true, payment_note: "This post was already accepted; the existing task is returned and no new hold was placed.", payment_label: payments().label };
  const attempt = job ? ((await latestAttempt(job.id, input.part_key!))?.attempt ?? 0) + 1 : null;

  const unknown = input.allowed_models.filter((m) => !isAllowlistedModel(m));
  if (unknown.length) {
    throw new MarketplaceError("MODEL_NOT_ALLOWED", `Models not on the allowlist: ${unknown.join(", ")}.`, {
      next_action: `Choose from: ${Object.keys(MODEL_ALLOWLIST).join(", ")} (see marketplace_info).`,
    });
  }
  const min = payments().min_cents;
  if (input.max_price_cents < min || input.max_price_cents > MAX_PRICE_CENTS) {
    throw new MarketplaceError("VALIDATION_ERROR", `max_price_cents must be between ${min} and ${MAX_PRICE_CENTS} (${payments().label}).`, {
      next_action: `Re-post with ${min} <= max_price_cents <= ${MAX_PRICE_CENTS}.`,
    });
  }
  const id = newId("task");
  const max_tokens = input.max_tokens ?? 512;
  const judgePayload: JudgePayload = { task_id: id, prompt: input.prompt, context: input.context, rubric: input.rubric };
  const plaintext: ServerPlaintext = { prompt: input.prompt, context: input.context, rubric: input.rubric, max_tokens };
  const row = {
    id,
    buyer_id: buyer.id,
    allowed_models: input.allowed_models,
    max_price_cents: input.max_price_cents,
    price_cents: offer,
    pricing_mode: "task_offer",
    max_runtime_s: input.max_runtime_s ?? DEFAULT_MAX_RUNTIME_SECONDS,
    status: "AWAITING_PAYMENT" as const,
    post_state: "HOLDING",
    created_at: nowIso(),
    updated_at: nowIso(),
    expires_at: plusSecondsIso(input.expires_in_s ?? DEFAULT_LISTING_TTL_SECONDS),
    plaintext_enc_server: kekSeal(plaintext),
    payload_enc_judge: sealJson(judgeKey(), judgePayload),
    payment_mode: payments().mode,
    payment_state: "POSTING",
    stripe_payment_intent_id: null,
    payment_link: null,
    claim_count: 0,
    job_id: job?.id ?? null,
    part_key: input.part_key ?? null,
    part_label: input.part_label ?? null,
    attempt,
    client_request_id: input.client_request_id ?? null,
  };
  let task: TaskRow;
  try {
    task = await prepareTask(row);
  } catch (err) {
    // The database may have committed before its response was lost. Read by
    // our stable id before doing anything to the payment or reservation.
    const accepted = await getTask(id);
    const winner = accepted ?? (isUniqueViolation(err) ? await existingPost(buyer, input) : null);
    if (winner) return { task: toTaskPublic(winner), idempotent: true, payment_note: "The recorded post is returned. No new hold was created; poll get_task while payment is pending.", payment_label: payments().label };
    throw err;
  }
  task = await finishPost(task, buyer);
  await logEvent("task.posted", {
    task_id: id,
    agent_id: buyer.id,
    meta: { allowed_models: input.allowed_models, max_price_cents: input.max_price_cents, rubric_kind: input.rubric.kind, payment_state: task.payment_state, job_id: job?.id ?? null, part_key: input.part_key ?? null, attempt },
  });
  return { task: toTaskPublic(task), idempotent: false, payment_note: task.post_hold?.note ?? "Task offer recorded.", payment_label: payments().label };
}

// ---------------------------------------------------------------------------
// Jobs: one buyer request split into parts (contract §10). No private text.
// ---------------------------------------------------------------------------

const NON_TERMINAL_STATUSES: readonly TaskStatus[] = ["CLAIMED", "PAYLOAD_READY", "RUNNING", "SUBMITTED", "JUDGING"];

/** Progress over the latest attempt of each part_key. */
export function summarizeJob(job: JobRow, parts: TaskRow[]): JobPublic {
  const latest = new Map<string, TaskRow>();
  for (const t of parts) {
    const key = t.part_key ?? t.id;
    const cur = latest.get(key);
    if (!cur || (t.attempt ?? 0) > (cur.attempt ?? 0)) latest.set(key, t);
  }
  const l = [...latest.values()];
  const count = (pred: (t: TaskRow) => boolean) => l.filter(pred).length;
  const progress: JobProgress = {
    parts: l.length,
    approved: count((t) => t.status === "APPROVED"),
    rejected: count((t) => t.status === "REJECTED"),
    in_progress: count((t) => NON_TERMINAL_STATUSES.includes(t.status)),
    open: count((t) => t.status === "OPEN" || t.status === "AWAITING_PAYMENT"),
    failed_latest: count((t) => FAILED_ATTEMPT_STATUSES.includes(t.status)),
  };
  const status: JobStatus = !l.length ? "EMPTY" : progress.in_progress + progress.open > 0 ? "IN_PROGRESS" : progress.approved === l.length ? "COMPLETE" : "PARTIAL_FAILURE";
  return { job_id: job.id, buyer_id: job.buyer_id, label_public: job.label_public, budget_cents: job.budget_cents, reserved_cents: job.reserved_cents, spent_cents: job.spent_cents, status, created_at: job.created_at, progress };
}

async function partsOf(jobIds: string[]): Promise<Map<string, TaskRow[]>> {
  const out = new Map<string, TaskRow[]>(jobIds.map((id) => [id, []]));
  if (!jobIds.length) return out;
  const rows = unwrap(await db().from("tasks").select("*").in("job_id", jobIds).order("created_at", { ascending: true }).limit(2000)) as TaskRow[];
  for (const t of rows) out.get(t.job_id!)?.push(t);
  return out;
}

export interface CreateJobInput {
  label_public?: string;
  budget_cents: number;
  client_job_key?: string;
}

export async function createJob(buyer: AgentRow, input: CreateJobInput): Promise<{ job: JobPublic; idempotent: boolean }> {
  if (input.client_job_key != null && !CLIENT_REQUEST_ID_PATTERN.test(input.client_job_key)) {
    throw new MarketplaceError("VALIDATION_ERROR", "client_job_key must match [A-Za-z0-9._-]{8,64}.", { next_action: "Generate one random key per job and reuse it when retrying create_job." });
  }
  const byKey = async () =>
    input.client_job_key ? await one<JobRow>(await db().from("jobs").select("*").eq("buyer_id", buyer.id).eq("client_job_key", input.client_job_key).limit(1)) : null;
  const existing = await byKey();
  if (existing) return { job: summarizeJob(existing, (await partsOf([existing.id])).get(existing.id)!), idempotent: true };
  const fresh = (await getAgent(buyer.id)) ?? buyer;
  const available = fresh.spend_cap_cents - fresh.reserved_cents - fresh.spent_cents;
  if (input.budget_cents > available) {
    throw new MarketplaceError("SPEND_CAP_EXCEEDED", `A ${input.budget_cents}c job budget exceeds your available ${available}c (cap ${fresh.spend_cap_cents}c).`, {
      next_action: "Lower budget_cents to at most available_cents from whoami. Only your human can raise the cap.",
    });
  }
  let job: JobRow;
  try {
    job = (unwrap(await db().from("jobs").insert({ id: newId("job"), buyer_id: buyer.id, label_public: input.label_public ?? null, budget_cents: input.budget_cents, client_job_key: input.client_job_key ?? null }).select()) as JobRow[])[0]!;
  } catch (err) {
    const winner = isUniqueViolation(err) ? await byKey() : null;
    if (winner) return { job: summarizeJob(winner, []), idempotent: true };
    throw err;
  }
  await logEvent("job.created", { agent_id: buyer.id, meta: { job_id: job.id, budget_cents: job.budget_cents } });
  return { job: summarizeJob(job, []), idempotent: false };
}

export async function getJobForBuyer(buyer: AgentRow, jobId: string) {
  await sweep();
  const job = await one<JobRow>(await db().from("jobs").select("*").eq("id", jobId).limit(1));
  if (!job || job.buyer_id !== buyer.id) throw new MarketplaceError("NOT_FOUND", `Unknown job ${jobId}.`, { next_action: "Call list_my_jobs for your job ids." });
  const parts = (await partsOf([job.id])).get(job.id)!;
  const summary = summarizeJob(job, parts);
  return { job: summary, progress: summary.progress, parts: parts.map(toTaskPublic) };
}

export async function listJobsForBuyer(buyer: AgentRow): Promise<JobPublic[]> {
  await sweep();
  const jobs = unwrap(await db().from("jobs").select("*").eq("buyer_id", buyer.id).order("created_at", { ascending: false }).limit(50)) as JobRow[];
  const parts = await partsOf(jobs.map((j) => j.id));
  return jobs.map((j) => summarizeJob(j, parts.get(j.id)!));
}

export async function listTasksForBuyer(buyer: AgentRow, status?: TaskStatus): Promise<TaskPublic[]> {
  await sweep();
  let q = db().from("tasks").select("*").eq("buyer_id", buyer.id).order("created_at", { ascending: false }).limit(50);
  if (status) q = q.eq("status", status);
  return (unwrap(await q) as TaskRow[]).map(toTaskPublic);
}

export async function getTaskForActor(actor: AgentRow, taskId: string): Promise<{ task: TaskPublic; verdict: ReturnType<typeof publicVerdict> | null; settlement: ReturnType<typeof publicSettlement> | null }> {
  await sweep();
  const task = await mustGetTask(taskId);
  if (actor.kind === "buyer" && task.buyer_id !== actor.id) throw new MarketplaceError("FORBIDDEN", "This task belongs to another buyer.", { next_action: "Call list_my_tasks for your own task ids." });
  if (actor.kind === "seller" && task.seller_id !== actor.id) throw new MarketplaceError("FORBIDDEN", "You do not hold this task's claim.", { next_action: "Call list_open_tasks for tasks you can claim." });
  const verdict = await latestVerdict(taskId);
  const settlement = await settlementFor(taskId);
  return { task: toTaskPublic(task), verdict: verdict ? publicVerdict(verdict) : null, settlement: settlement ? publicSettlement(settlement) : null };
}

export async function getResultForBuyer(buyer: AgentRow, taskId: string) {
  await sweep();
  const task = await mustGetTask(taskId);
  if (task.buyer_id !== buyer.id) throw new MarketplaceError("FORBIDDEN", "This task belongs to another buyer.", { next_action: "Call list_my_tasks for your own task ids." });
  const result = await latestResult(taskId);
  const verdict = await latestVerdict(taskId);
  const settlement = await settlementFor(taskId);
  if (!buyer.buyer_secret_enc) throw new MarketplaceError("INTERNAL_ERROR", "Buyer has no decryption key on file.");
  const kp = keypairFromSecretB64(kekOpen<string>(buyer.buyer_secret_enc));

  let answer: string | null = null;
  let commitment_verified: boolean | null = null;
  if (result) {
    try {
      const bytes = open(kp, result.result_enc_buyer);
      const parsed = JSON.parse(fromUtf8(bytes)) as ResultPlaintext;
      commitment_verified = commitment(parsed).sha256_hex === result.commitment_sha256;
      answer = parsed.answer;
    } catch (err) {
      commitment_verified = false;
      answer = null;
      await logEvent("result.decrypt_failed", { task_id: taskId, agent_id: buyer.id, meta: { error: (err as Error).message } });
    }
  }
  const replacement_status = replacementStatusOf(task);
  let replacement_answer: string | null = null;
  // Rows written before v0.3 have no stored status; an envelope on the verdict means it was delivered.
  if (verdict?.replacement_enc_buyer && (replacement_status === "DELIVERED" || !task.replacement_status)) {
    try {
      const parsed = JSON.parse(fromUtf8(open(kp, verdict.replacement_enc_buyer))) as { answer: string };
      replacement_answer = parsed.answer;
    } catch {
      replacement_answer = null;
    }
  }
  return {
    task: toTaskPublic(task),
    result: result
      ? { result_id: result.id, model_id: result.model_id, runtime_ms: result.runtime_ms, commitment_sha256: result.commitment_sha256, commitment_verified, answer, result_enc_buyer: result.result_enc_buyer }
      : null,
    verdict: verdict ? { verdict: verdict.verdict, reason_code: verdict.reason_code, reason_public: publicReason(verdict.reason_code), score: verdict.score, created_at: verdict.created_at } : null,
    replacement_status,
    replacement_answer,
    settlement: settlement ? publicSettlement(settlement) : null,
    guidance: resultGuidance(task, replacement_status, !!replacement_answer),
  };
}

function resultGuidance(task: TaskRow, replacement: TaskPublic["replacement_status"], haveReplacement: boolean): string {
  if (task.status === "APPROVED") return "Seller result approved by the judge; `answer` is the seller's output.";
  if (task.status === "REJECTED") {
    if (haveReplacement) return "Seller result rejected; the hold was released, so you paid nothing. `replacement_answer` is the judge's own answer.";
    if (replacement === "PENDING") return "Seller result rejected; the hold was released. A judge-produced replacement is still being prepared; call get_result again later.";
    return "Seller result rejected; the hold was released. No replacement answer is available; post a new task if you still need one.";
  }
  const review = reviewOf(task);
  if (review.status === "RETRY_PENDING" || review.status === "JUDGE_UNAVAILABLE") {
    return `The judge could not complete the review (${review.status}); it is retried automatically${review.retry_at ? ` after ${review.retry_at}` : ""}. Nothing has been charged.`;
  }
  return `Task is ${task.status}; call get_result again later. A commitment-verified answer before APPROVED is intact but not yet judged.`;
}

export async function cancelTask(buyer: AgentRow, taskId: string): Promise<TaskPublic> {
  const task = await mustGetTask(taskId);
  if (task.buyer_id !== buyer.id) throw new MarketplaceError("FORBIDDEN", "This task belongs to another buyer.", { next_action: "Call list_my_tasks for your own task ids." });
  if (task.post_state === "HOLDING" || task.post_state === "CANCEL_PENDING") return toTaskPublic(await cancelPosting(task, buyer));
  if (task.status !== "OPEN" && task.status !== "AWAITING_PAYMENT") {
    throw new MarketplaceError("INVALID_STATE", `Only OPEN tasks can be cancelled; this one is ${task.status}.`, {
      next_action: "A claimed task settles through the judge; poll get_task / get_result instead.",
    });
  }
  // Close the listing first (no claim can win after this), then settle durably (contract §9).
  const rows = unwrap(
    await db().from("tasks").update({ status: "CANCELLED", settle_pending: true, plaintext_enc_server: null, updated_at: nowIso() }).eq("id", taskId).eq("status", task.status).select(),
  ) as TaskRow[];
  if (!rows.length) throw new MarketplaceError("INVALID_STATE", "Task changed state while cancelling; read it again.", { next_action: "Call get_task, then cancel_task again if it is still OPEN." });
  await logEvent("task.cancelled", { task_id: taskId, agent_id: buyer.id });
  return toTaskPublic(await settleClosed(rows[0]!, "CANCEL"));
}

/**
 * Settle a task already moved to CANCELLED/EXPIRED. A provider failure leaves
 * the decision recorded for the sweep instead of failing the caller.
 */
async function settleClosed(task: TaskRow, outcome: "CANCEL" | "EXPIRE", reason?: string): Promise<TaskRow> {
  await recordIntent(task, { outcome, seller_payout_cents: 0, release_reason: reason ?? null });
  try {
    return (await finalizeSettlement(task.id)).task;
  } catch (err) {
    if (!(err instanceof MarketplaceError && err.code === "PAYMENT_FAILED")) throw err;
    warnOnce(`settle:${task.id}`, `[settle] ${task.id} ${outcome}: hold release not confirmed; housekeeping will retry`);
    return (await getTask(task.id)) ?? task;
  }
}

// ---------------------------------------------------------------------------
// Seller: list / claim / lease / result
// ---------------------------------------------------------------------------

export const OPEN_TASKS_DEFAULT_LIMIT = 50;
export const OPEN_TASKS_MAX_LIMIT = 100;

export async function listOpenTasksFor(agent: AgentRow, limit = OPEN_TASKS_DEFAULT_LIMIT): Promise<{ tasks: (TaskPublic & { eligible_models: string[] })[]; seller_models: string[] }> {
  await sweep();
  const seller = await getSeller(agent.id);
  const myModels = seller?.models ?? [];
  const n = Math.min(Math.max(1, Math.trunc(limit) || OPEN_TASKS_DEFAULT_LIMIT), OPEN_TASKS_MAX_LIMIT);
  const rows = unwrap(await db().from("tasks").select("*").eq("status", "OPEN").order("created_at", { ascending: true }).limit(n)) as TaskRow[];
  const tasks = rows
    .map((t) => {
      const eligible = myModels.filter((m) => t.allowed_models.includes(m.model_id)).map((m) => m.model_id);
      return { ...toTaskPublic(t), eligible_models: eligible };
    })
    .filter((t) => myModels.length === 0 || t.eligible_models.length > 0);
  return { tasks, seller_models: myModels.map((m) => m.model_id) };
}

export interface ClaimKeyInput {
  /** v0.2: X25519 key generated inside the sandbox instance that will decrypt this claim. */
  runner_pubkey_b64?: string;
  runner_key_id?: string;
}

export async function claimTask(agent: AgentRow, taskId: string, modelId: string, perClaim: ClaimKeyInput = {}): Promise<ClaimPublicV02> {
  if (agent.owner_user_id && payments().mode !== "mock" && (await sellerPayoutInfo(agent)).payout_status !== "ACTIVE") {
    throw new MarketplaceError("FORBIDDEN", "Complete Stripe payout onboarding before accepting tasks.", { next_action: "Open the local seller dashboard and finish Stripe setup." });
  }
  if (perClaim.runner_key_id && !perClaim.runner_pubkey_b64) {
    throw new MarketplaceError("VALIDATION_ERROR", "runner_key_id was sent without runner_pubkey_b64.", {
      next_action: "Send runner_pubkey_b64 (and optionally runner_key_id) together, or neither to use your registered key.",
    });
  }
  const claimKey = perClaim.runner_pubkey_b64 ? runnerKey(perClaim.runner_pubkey_b64, perClaim.runner_key_id) : null;
  await sweep();
  const seller = await getSeller(agent.id);
  if (!seller) throw new MarketplaceError("INVALID_STATE", "This seller has not called register_seller yet.", { next_action: "Call register_seller with your local models first." });
  const registeredKey = seller.runner_pubkey_b64 && seller.runner_key_id ? { key_id: seller.runner_key_id, public_key_b64: seller.runner_pubkey_b64 } : null;
  const sealTo = claimKey ?? registeredKey;
  const keySource: RunnerKeySource = claimKey ? "per-claim" : "registered";
  if (seller.status === "SUSPENDED") {
    throw new MarketplaceError("SELLER_SUSPENDED", "This seller is suspended after a rejected result.", { next_action: "Stop claiming; the operator must lift the suspension (get_seller_reputation shows strikes)." });
  }
  if (!sealTo) {
    throw new MarketplaceError("INVALID_STATE", "No runner key: this seller registered without one, so claim_task must carry a per-claim key.", {
      next_action: "Call claim_task with runner_pubkey_b64 (and runner_key_id) generated inside the sandbox instance that will run the task, or register_seller with a runner key.",
    });
  }
  const task = await mustGetTask(taskId);
  if (task.status !== "OPEN") throw new MarketplaceError("CLAIM_CONFLICT", `Task is ${task.status}, not OPEN.`, { next_action: "Call list_open_tasks for tasks you can still claim." });
  if (!task.allowed_models.includes(modelId)) {
    throw new MarketplaceError("MODEL_NOT_ALLOWED", `Buyer allows ${task.allowed_models.join(", ")}; ${modelId} is not among them.`, {
      next_action: "Claim with one of the task's eligible_models from list_open_tasks.",
    });
  }
  const mine = seller.models.find((m) => m.model_id === modelId);
  if (!mine) throw new MarketplaceError("MODEL_NOT_ALLOWED", `${modelId} is not in your registration.`, { next_action: "Call register_seller with your current Ollama models." });
  const price = task.price_cents ?? task.max_price_cents;
  const active = unwrap(await db().from("tasks").select("id").eq("seller_id", agent.id).in("status", [...ACTIVE_CLAIM_STATUSES]).limit(1)) as { id: string }[];
  if (active.length) {
    throw new MarketplaceError("CLAIM_CONFLICT", `You already hold an active claim (${active[0]!.id}); finish or release it first.`, {
      next_action: `submit_result or release_task for ${active[0]!.id}.`,
    });
  }
  if (!task.plaintext_enc_server) throw new MarketplaceError("INVALID_STATE", "Task payload is no longer available.", { next_action: "Call list_open_tasks and pick another task." });

  const claimId = newId("claim");
  const pt = kekOpen<ServerPlaintext>(task.plaintext_enc_server);
  const sellerPayload: SellerPayload = { task_id: task.id, claim_id: claimId, prompt: pt.prompt, context: pt.context, max_tokens: pt.max_tokens };
  const envelope = sealJson(sealTo, sellerPayload);
  const recipients = await recipientKeysFor(task);
  const lease = plusSecondsIso(LEASE_SECONDS);
  const rows = unwrap(
    await db()
      .from("tasks")
      .update({
        status: "PAYLOAD_READY",
        claim_id: claimId,
        seller_id: agent.id,
        model_id: modelId,
        price_cents: price,
        pricing_mode: "task_offer",
        lease_expires_at: lease,
        payload_enc_seller: envelope,
        claim_runner_key_id: sealTo.key_id,
        claim_runner_pubkey_b64: sealTo.public_key_b64,
        claim_count: task.claim_count + 1,
        updated_at: nowIso(),
      })
      .eq("id", task.id)
      .eq("status", "OPEN")
      .select(),
  ) as TaskRow[];
  if (!rows.length) throw new MarketplaceError("CLAIM_CONFLICT", "Another seller claimed this task first.", { retryable: true, next_action: "Call list_open_tasks again." });
  unwrap(
    await db()
      .from("sellers")
      .update({ last_seen: nowIso(), ...(claimKey ? { last_claim_key_id: claimKey.key_id, last_claim_pubkey_b64: claimKey.public_key_b64 } : {}) })
      .eq("agent_id", agent.id),
  );
  await logEvent("task.claimed", { task_id: task.id, agent_id: agent.id, meta: { claim_id: claimId, model_id: modelId, price_cents: price, lease_expires_at: lease, runner_key_id: sealTo.key_id, runner_key_source: keySource } });
  const updated = rows[0]!;
  await notifyTask(updated, { type: "assignment", to_handle: agent.inkbox_handle, text: `Task ${task.id} assigned to you (${modelId}, ${price}c). Lease until ${lease}.` });
  return {
    claim_id: claimId,
    task_id: task.id,
    seller_id: agent.id,
    model_id: modelId,
    price_cents: price,
    lease_expires_at: lease,
    seller_envelope: envelope,
    max_runtime_s: updated.max_runtime_s,
    runner_key_id: sealTo.key_id,
    runner_key_source: keySource,
    ...recipients,
  };
}

async function requireLiveClaim(agent: AgentRow, taskId: string, claimId: string): Promise<TaskRow> {
  const task = await mustGetTask(taskId);
  if (task.seller_id !== agent.id || task.claim_id !== claimId) {
    throw new MarketplaceError("LEASE_EXPIRED", "This claim is no longer yours (expired, released, or replaced).", { next_action: "Stop work on it and call list_open_tasks." });
  }
  if (!ACTIVE_CLAIM_STATUSES.includes(task.status)) {
    throw new MarketplaceError("INVALID_STATE", `Task is ${task.status}; the claim is not active.`, { next_action: "Stop work on it; call get_task to see its outcome." });
  }
  if (isPast(task.lease_expires_at)) {
    await sweep();
    throw new MarketplaceError("LEASE_EXPIRED", "Lease expired before this call.", { next_action: "Call list_open_tasks; the task may be OPEN again." });
  }
  return task;
}

async function recipientKeysFor(task: TaskRow): Promise<{ buyer_public_key: KeyDescriptor; judge_public_key: KeyDescriptor }> {
  const buyer = await getAgent(task.buyer_id);
  if (!buyer?.buyer_pubkey_b64 || !buyer.buyer_key_id) throw new MarketplaceError("INTERNAL_ERROR", "Buyer has no public key on file.");
  return { buyer_public_key: { key_id: buyer.buyer_key_id, public_key_b64: buyer.buyer_pubkey_b64 }, judge_public_key: judgeKey() };
}

export async function recipientKeys(agent: AgentRow, taskId: string, claimId: string): Promise<{ buyer_public_key: KeyDescriptor; judge_public_key: KeyDescriptor }> {
  return recipientKeysFor(await requireLiveClaim(agent, taskId, claimId));
}

export async function renewLease(agent: AgentRow, taskId: string, claimId: string): Promise<{ lease_expires_at: string }> {
  await requireLiveClaim(agent, taskId, claimId);
  const lease = plusSecondsIso(LEASE_SECONDS);
  unwrap(await db().from("tasks").update({ lease_expires_at: lease, updated_at: nowIso() }).eq("id", taskId).eq("claim_id", claimId));
  return { lease_expires_at: lease };
}

export async function startTask(agent: AgentRow, taskId: string, claimId: string): Promise<TaskPublic> {
  await requireLiveClaim(agent, taskId, claimId);
  const rows = unwrap(await db().from("tasks").update({ status: "RUNNING", updated_at: nowIso() }).eq("id", taskId).eq("claim_id", claimId).select()) as TaskRow[];
  await logEvent("task.running", { task_id: taskId, agent_id: agent.id, meta: { claim_id: claimId } });
  return toTaskPublic(rows[0]!);
}

export async function releaseTask(agent: AgentRow, taskId: string, claimId: string, reason: string): Promise<TaskPublic> {
  const task = await requireLiveClaim(agent, taskId, claimId);
  await logEvent("task.released", { task_id: taskId, agent_id: agent.id, meta: { claim_id: claimId, reason } });
  const updated = isPast(task.expires_at) ? await finalizeExpired(task, `released by seller: ${reason}`) : await reopen(task, `released by seller: ${reason}`);
  return toTaskPublic(updated);
}

export interface SubmitResultInput {
  result_enc_buyer: Envelope;
  result_enc_judge: Envelope;
  commitment_sha256: string;
  runtime_ms: number;
  tokens_out?: number;
}

export async function submitResult(agent: AgentRow, taskId: string, claimId: string, input: SubmitResultInput): Promise<{ result_id: string; task: TaskPublic }> {
  const task = await requireLiveClaim(agent, taskId, claimId);
  const buyer = await getAgent(task.buyer_id);
  if (buyer?.buyer_key_id && input.result_enc_buyer.recipient_key_id !== buyer.buyer_key_id) {
    throw new MarketplaceError("VALIDATION_ERROR", `result_enc_buyer must be encrypted to ${buyer.buyer_key_id}.`, { next_action: "Seal to buyer_public_key from the claim_task response (or get_recipient_keys) and resubmit." });
  }
  if (input.result_enc_judge.recipient_key_id !== env().JUDGE_KEY_ID) {
    throw new MarketplaceError("VALIDATION_ERROR", `result_enc_judge must be encrypted to ${env().JUDGE_KEY_ID}.`, { next_action: "Seal to judge_public_key from the claim_task response (or get_recipient_keys) and resubmit." });
  }
  const resultId = newId("result");
  unwrap(
    await db().from("results").insert({
      id: resultId,
      task_id: taskId,
      claim_id: claimId,
      seller_id: agent.id,
      model_id: task.model_id,
      result_enc_buyer: input.result_enc_buyer,
      result_enc_judge: input.result_enc_judge,
      commitment_sha256: input.commitment_sha256,
      runtime_ms: input.runtime_ms,
      tokens_out: input.tokens_out ?? null,
    }),
  );
  const rows = unwrap(
    await db()
      .from("tasks")
      .update({ status: "SUBMITTED", plaintext_enc_server: null, payload_enc_seller: null, updated_at: nowIso() })
      .eq("id", taskId)
      .eq("claim_id", claimId)
      .in("status", [...ACTIVE_CLAIM_STATUSES])
      .select(),
  ) as TaskRow[];
  if (!rows.length) throw new MarketplaceError("INVALID_STATE", "Task left the active state while submitting.", { next_action: "Call get_task; the lease may have lapsed and the task reopened." });
  unwrap(await db().from("sellers").update({ last_seen: nowIso() }).eq("agent_id", agent.id));
  await logEvent("result.submitted", { task_id: taskId, agent_id: agent.id, meta: { claim_id: claimId, result_id: resultId, runtime_ms: input.runtime_ms, commitment_sha256: input.commitment_sha256 } });
  await notifyTask(rows[0]!, { type: "submitted", to_handle: null, text: `Result for ${taskId} submitted; awaiting judge.` });
  return { result_id: resultId, task: toTaskPublic(rows[0]!) };
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

export interface ReviewPackage {
  task_id: string;
  result_id: string;
  claim_id: string;
  seller_id: string;
  model_id: string;
  max_runtime_s: number;
  payload_enc_judge: Envelope;
  result_enc_judge: Envelope;
  commitment_sha256: string;
  buyer_public_key: KeyDescriptor;
}

export async function fetchReviewPackage(judge: AgentRow): Promise<ReviewPackage | null> {
  await sweep();
  const now = Date.now();
  const candidates = (unwrap(await db().from("tasks").select("*").eq("status", "SUBMITTED").order("updated_at", { ascending: true }).limit(25)) as TaskRow[]).filter((t) => reviewDue(t, now));
  for (const t of candidates) {
    // A recorded decision is finished by housekeeping, never judged twice.
    if (await settlementOf(t.id)) continue;
    const rows = unwrap(await db().from("tasks").update({ status: "JUDGING", judge_id: judge.id, updated_at: nowIso() }).eq("id", t.id).eq("status", "SUBMITTED").select()) as TaskRow[];
    if (!rows.length) continue;
    const task = rows[0]!;
    const result = await latestResult(task.id);
    const buyer = await getAgent(task.buyer_id);
    if (!result || !task.payload_enc_judge || !buyer?.buyer_pubkey_b64 || !buyer.buyer_key_id) {
      unwrap(await db().from("tasks").update({ status: "SUBMITTED", judge_id: null }).eq("id", task.id));
      continue;
    }
    await logEvent("task.judging", { task_id: task.id, agent_id: judge.id, meta: { result_id: result.id } });
    return {
      task_id: task.id,
      result_id: result.id,
      claim_id: result.claim_id,
      seller_id: result.seller_id,
      model_id: result.model_id,
      max_runtime_s: task.max_runtime_s,
      payload_enc_judge: task.payload_enc_judge,
      result_enc_judge: result.result_enc_judge,
      commitment_sha256: result.commitment_sha256,
      buyer_public_key: { key_id: buyer.buyer_key_id, public_key_b64: buyer.buyer_pubkey_b64 },
    };
  }
  return null;
}

export interface SubmitVerdictInput {
  task_id: string;
  result_id: string;
  verdict: Verdict;
  reason_code: VerdictReasonCode;
  /** Accepted for v0.2 judges; never stored or published (contract §8.1). */
  reason_public?: string;
  score?: number;
  replacement_enc_buyer?: Envelope;
}

export async function submitVerdict(judge: AgentRow, input: SubmitVerdictInput) {
  const task = await mustGetTask(input.task_id);
  const existing = await settlementFor(task.id);
  if (existing) {
    // A decision is recorded: finish it, whatever this call says (contract §9).
    const r = existing.finalized_at || !existing.outcome ? null : await finalizeSettlement(task.id);
    const v = await latestVerdict(task.id);
    const now = r?.task ?? (await mustGetTask(task.id));
    return { idempotent: true, resumed: !!r?.finishedNow, deferred: false, task: toTaskPublic(now), review: reviewOf(now), verdict: v ? publicVerdict(v) : null, settlement: publicSettlement(r?.settlement ?? existing), seller_status: r?.sellerStatus ?? null };
  }
  if (task.status !== "JUDGING" && task.status !== "SUBMITTED") {
    throw new MarketplaceError("INVALID_STATE", `Task is ${task.status}; verdicts apply to JUDGING tasks.`, { next_action: "Call fetch_review_package for the next task waiting for review." });
  }
  const res = await one<ResultRow>(await db().from("results").select("*").eq("id", input.result_id).eq("task_id", task.id).limit(1));
  if (!res) throw new MarketplaceError("NOT_FOUND", `Result ${input.result_id} not found for task ${task.id}.`, { next_action: "Use the result_id from fetch_review_package." });

  // Judge infrastructure failure: retry later, no verdict, no settlement, no strike (contract §8.2).
  if (isInfraReason(input.reason_code)) {
    const d = await deferReview(judge, task, input.reason_code);
    const seller = task.seller_id ? await getSeller(task.seller_id) : null;
    return { idempotent: false, resumed: false, deferred: true, task: toTaskPublic(d.task), review: d.review, verdict: null, settlement: null, seller_status: seller?.status ?? null };
  }
  const allowed = input.verdict === "APPROVE" ? APPROVE_REASON_CODES : REJECT_REASON_CODES;
  if (!allowed.includes(input.reason_code)) {
    throw new MarketplaceError("VALIDATION_ERROR", `${input.reason_code} cannot accompany ${input.verdict}.`, {
      next_action: `Use one of ${allowed.join(", ")} for ${input.verdict}, or a judge infrastructure code to defer the review.`,
    });
  }
  if (input.replacement_enc_buyer) {
    const buyer = await getAgent(task.buyer_id);
    if (buyer?.buyer_key_id && input.replacement_enc_buyer.recipient_key_id !== buyer.buyer_key_id) {
      throw new MarketplaceError("VALIDATION_ERROR", `replacement_enc_buyer must be sealed to ${buyer.buyer_key_id}.`, { next_action: "Seal to buyer_public_key from fetch_review_package and resubmit." });
    }
  }

  // Record the decision first; then money, verdict row, task, reputation and balances, each exactly once.
  await recordIntent(task, {
    outcome: input.verdict,
    seller_payout_cents: input.verdict === "APPROVE" ? task.price_cents ?? 0 : 0,
    result_id: res.id,
    reason_code: input.reason_code,
    judge_id: judge.id,
    score: input.score ?? null,
    replacement_enc_buyer: input.replacement_enc_buyer ?? null,
  });
  const r = await finalizeSettlement(task.id);
  const v = await latestVerdict(task.id);
  return { idempotent: !r.finishedNow, resumed: false, deferred: false, task: toTaskPublic(r.task), review: reviewOf(r.task), verdict: v ? publicVerdict(v) : null, settlement: publicSettlement(r.settlement), seller_status: r.sellerStatus };
}

// ---------------------------------------------------------------------------
// Expiry (settlement itself lives in settlement.ts)
// ---------------------------------------------------------------------------

async function finalizeExpired(task: TaskRow, reason: string): Promise<TaskRow> {
  const rows = unwrap(
    await db()
      .from("tasks")
      .update({ status: "EXPIRED", settle_pending: true, plaintext_enc_server: null, payload_enc_seller: null, claim_id: null, seller_id: null, lease_expires_at: null, claim_runner_key_id: null, claim_runner_pubkey_b64: null, updated_at: nowIso() })
      .eq("id", task.id)
      .eq("status", task.status)
      .select(),
  ) as TaskRow[];
  if (!rows.length) return task;
  await logEvent("task.expired", { task_id: task.id, meta: { reason, previous_status: task.status } });
  return settleClosed(rows[0]!, "EXPIRE", reason);
}

async function reopen(task: TaskRow, reason: string): Promise<TaskRow> {
  const rows = unwrap(
    await db()
      .from("tasks")
      .update({ status: "OPEN", claim_id: null, seller_id: null, model_id: null, lease_expires_at: null, payload_enc_seller: null, claim_runner_key_id: null, claim_runner_pubkey_b64: null, updated_at: nowIso() })
      .eq("id", task.id)
      .eq("claim_id", task.claim_id)
      .select(),
  ) as TaskRow[];
  if (rows.length) await logEvent("task.reopened", { task_id: task.id, meta: { reason, previous_claim_id: task.claim_id, previous_seller_id: task.seller_id } });
  return rows[0] ?? task;
}

export async function expireStale(): Promise<{ expired: number; reopened: number; requeued: number; resumed: number; transfers_retried: number; failed: number }> {
  await ensureSchema();
  const now = nowIso();
  let expired = 0, reopened = 0, requeued = 0, resumed = await resumePosts(), failed = 0;
  // One task whose Stripe release or update fails must not block the rest of the sweep.
  const each = async (t: TaskRow, fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (err) {
      failed++;
      warnOnce(`expire:${t.id}`, `[expire] ${t.id} (${t.status}): ${(err as Error).message}`);
      return false;
    }
  };
  const deadListings = unwrap(await db().from("tasks").select("*").in("status", ["OPEN", "AWAITING_PAYMENT"]).lt("expires_at", now).limit(50)) as TaskRow[];
  for (const t of deadListings) if (t.post_state !== "HOLDING" && await each(t, () => finalizeExpired(t, "listing deadline passed"))) expired++;
  const deadLeases = unwrap(await db().from("tasks").select("*").in("status", [...ACTIVE_CLAIM_STATUSES]).lt("lease_expires_at", now).limit(50)) as TaskRow[];
  for (const t of deadLeases) {
    if (isPast(t.expires_at)) { if (await each(t, () => finalizeExpired(t, "lease expired after listing deadline"))) expired++; }
    else if (await each(t, () => reopen(t, "lease expired"))) reopened++;
  }
  const stuck = unwrap(await db().from("tasks").select("*").eq("status", "JUDGING").lt("updated_at", new Date(Date.now() - JUDGING_TIMEOUT_S * 1000).toISOString()).limit(20)) as TaskRow[];
  for (const t of stuck) {
    if (await settlementOf(t.id)) continue; // decided; resumed below instead of re-judged
    const ok = await each(t, async () => unwrap(await db().from("tasks").update({ status: "SUBMITTED", judge_id: null, updated_at: nowIso() }).eq("id", t.id).eq("status", "JUDGING")));
    if (ok) requeued++;
  }
  // Finish settlements a crash or provider outage left half done (contract §9).
  const cutoff = new Date(Date.now() - RESUME_AFTER_S * 1000).toISOString();
  const unfinished = unwrap(await db().from("settlements").select("task_id").is("finalized_at", null).lt("created_at", cutoff).limit(20)) as { task_id: string }[];
  for (const u of unfinished) {
    if (await each({ id: u.task_id, status: "SETTLING" } as unknown as TaskRow, () => finalizeSettlement(u.task_id))) resumed++;
  }
  const closing = unwrap(await db().from("tasks").select("*").is("settle_pending", true).lt("updated_at", cutoff).limit(20)) as TaskRow[];
  for (const t of closing) {
    const outcome = outcomeForStatus(t.status);
    if (!outcome || (await settlementOf(t.id))) continue; // an intent exists: handled above
    if (await each(t, async () => { await recordIntent(t, { outcome, seller_payout_cents: 0 }); await finalizeSettlement(t.id); })) resumed++;
  }
  let transfers_retried = 0;
  try {
    transfers_retried = (await retryPendingTransfers()).attempted;
  } catch (err) {
    failed++;
    warnOnce(`transfers:${(err as Error).message}`, `[transfers] retry pass failed: ${(err as Error).message}`);
  }
  return { expired, reopened, requeued, resumed, transfers_retried, failed };
}

const warned = new Set<string>();
function warnOnce(key: string, line: string): void {
  if (warned.has(key)) return;
  if (warned.size > 1000) warned.clear();
  warned.add(key);
  console.warn(line);
}

/**
 * Lazy housekeeping run at the start of read and claim paths. Never throws:
 * a failing sweep must not fail the tool that triggered it.
 */
export async function sweep(): Promise<void> {
  try {
    await expireStale();
  } catch (err) {
    warnOnce(`sweep:${(err as Error).message}`, `[expire] sweep failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

export async function listSellers(): Promise<SellerPublic[]> {
  const sellers = unwrap(await db().from("sellers").select("*").order("last_seen", { ascending: false }).limit(50)) as SellerRow[];
  const out: SellerPublic[] = [];
  for (const s of sellers) {
    const a = await getAgent(s.agent_id);
    if (a) out.push(toSellerPublic(s, a));
  }
  return out;
}

export async function sellerReputation(sellerId: string): Promise<SellerPublic> {
  const s = await getSeller(sellerId);
  const a = await getAgent(sellerId);
  if (!s || !a) throw new MarketplaceError("NOT_FOUND", `Unknown seller ${sellerId}.`, { next_action: "Call list_sellers for valid seller ids." });
  return toSellerPublic(s, a);
}

export async function dashboard() {
  await sweep();
  const tasks = (unwrap(await db().from("tasks").select("*").order("created_at", { ascending: false }).limit(40)) as TaskRow[]).map(toTaskPublic);
  const sellers = await listSellers();
  const events = unwrap(await db().from("events").select("*").order("created_at", { ascending: false }).limit(60));
  // Stored reason_public is never read: rows written before v0.3 may hold judge free text (contract §8.1).
  const verdicts = (unwrap(await db().from("verdicts").select("id,task_id,verdict,reason_code,score,created_at").order("created_at", { ascending: false }).limit(40)) as Pick<VerdictRow, "id" | "task_id" | "verdict" | "reason_code" | "score" | "created_at">[])
    .map((v) => ({ ...v, reason_public: publicReason(v.reason_code) }));
  const settlements = (unwrap(await db().from("settlements").select("*").order("created_at", { ascending: false }).limit(40)) as SettlementRow[]).map(publicSettlement);
  const jobRows = unwrap(await db().from("jobs").select("*").order("created_at", { ascending: false }).limit(20)) as JobRow[];
  const jobParts = await partsOf(jobRows.map((j) => j.id));
  const jobs = jobRows.map((j) => summarizeJob(j, jobParts.get(j.id)!));
  return {
    generated_at: nowIso(),
    payments: { mode: payments().mode, label: payments().label },
    db: dbLabel(),
    counts: await countTasksByStatus(),
    tasks,
    sellers,
    verdicts,
    settlements,
    jobs,
    events,
  };
}

/** Bounded metadata observations; classes do not imply equal prompt complexity. */
export async function marketPriceObservations() {
  await ensureSchema();
  const rows = unwrap(await db().from("tasks").select("id,allowed_models,max_runtime_s,price_cents,max_price_cents,status,created_at,claim_count").eq("pricing_mode", "task_offer").order("created_at", { ascending: false }).limit(500)) as TaskRow[];
  const ids = rows.map((t) => t.id);
  const events = ids.length ? unwrap(await db().from("events").select("task_id,created_at").in("task_id", ids).eq("type", "task.claimed").order("created_at", { ascending: true }).limit(5000)) as { task_id: string; created_at: string }[] : [];
  const firstClaim = new Map<string, string>();
  for (const e of events) if (!firstClaim.has(e.task_id)) firstClaim.set(e.task_id, e.created_at);
  const grouped = new Map<string, TaskRow[]>();
  for (const t of rows) {
    const key = JSON.stringify([[...new Set(t.allowed_models)].sort(), t.max_runtime_s]);
    grouped.set(key, [...(grouped.get(key) ?? []), t]);
  }
  const band = (values: number[]) => {
    const v = [...values].sort((a,b) => a-b);
    const at = (q: number) => v.length ? v[Math.floor((v.length - 1) * q)]! : null;
    return { p25: at(.25), median: at(.5), p75: at(.75) };
  };
  return {
    mode: "task_offer", generated_at: nowIso(), sample_limit: 500, sample_count: rows.length,
    coverage: "Most recent 500 task-offer listings; at most 5000 claim events. Legacy seller-ask rows excluded.",
    limitation: "Model set and runtime limit do not measure prompt complexity. These observations do not establish market equilibrium or authorize spending.",
    groups: [...grouped.values()].map((tasks) => {
      const accepted = tasks.filter((t) => t.claim_count > 0);
      const fill = accepted.flatMap((t) => {
        const time = firstClaim.get(t.id);
        return time ? [Math.max(0, Date.parse(time) - Date.parse(t.created_at))] : [];
      });
      return {
        allowed_models: [...new Set(tasks[0]!.allowed_models)].sort(), max_runtime_s: tasks[0]!.max_runtime_s,
        sample_count: tasks.length, accepted_count: accepted.length,
        sample_status: accepted.length >= 5 ? "observations_available" : "insufficient_data",
        posted_price_cents: band(tasks.map((t) => t.price_cents ?? t.max_price_cents)),
        accepted_price_cents: band(accepted.map((t) => t.price_cents ?? t.max_price_cents)),
        fill_time_ms: band(fill), fill_time_sample_count: fill.length,
        claim_rate: accepted.length / tasks.length,
        expiry_rate: tasks.filter((t) => t.status === "EXPIRED").length / tasks.length,
        approved_count: tasks.filter((t) => t.status === "APPROVED").length,
        open_count: tasks.filter((t) => t.status === "OPEN").length,
      };
    }),
  };
}
