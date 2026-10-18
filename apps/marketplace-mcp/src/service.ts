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
  sealJson,
  toB64,
} from "@atm/crypto";
import {
  ACTIVE_CLAIM_STATUSES,
  DEFAULT_LISTING_TTL_SECONDS,
  DEFAULT_MAX_RUNTIME_SECONDS,
  Envelope,
  LEASE_SECONDS,
  MODEL_ALLOWLIST,
  MarketplaceError,
  ModelInfo,
  Rubric,
  isAllowlistedModel,
  isPast,
  nowIso,
  plusSecondsIso,
  type AgentKind,
  type ClaimPublic,
  type JudgePayload,
  type KeyDescriptor,
  type ResultPlaintext,
  type SellerPayload,
  type SellerPublic,
  type TaskPublic,
  type TaskStatus,
  type Verdict,
  type VerdictReasonCode,
} from "@atm/shared";
import { hashApiKey } from "./auth.js";
import { db, logEvent, one, rawSql, unwrap, type AgentRow, type ResultRow, type SellerRow, type SettlementRow, type TaskRow, type VerdictRow } from "./db.js";
import { env } from "./env.js";
import { newApiKey, newId } from "./ids.js";
import { inkbox } from "./inkbox.js";
import { kekOpen, kekSeal } from "./kek.js";
import { payments } from "./payments.js";

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
  if (!t) throw new MarketplaceError("NOT_FOUND", `Unknown task ${id}.`);
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
    price_cents: t.price_cents,
    lease_expires_at: t.lease_expires_at,
    payment: {
      mode: t.payment_mode,
      state: t.payment_state,
      stripe_payment_intent_id: t.stripe_payment_intent_id,
      payment_link: t.payment_link,
    },
    inkbox_context_id: t.inkbox_context_id,
  };
}

export function toSellerPublic(s: SellerRow, a: AgentRow): SellerPublic {
  return {
    seller_id: a.id,
    display_name: a.display_name,
    status: s.status,
    models: s.models,
    runner: {
      public_key: { key_id: s.runner_key_id ?? "unregistered", public_key_b64: s.runner_pubkey_b64 ?? "" },
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
  if (input.kind === "judge" && input.judge_secret !== env().JUDGE_REGISTRATION_SECRET) {
    throw new MarketplaceError("FORBIDDEN", "Judge registration requires the operator's JUDGE_REGISTRATION_SECRET.");
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

export interface RegisterSellerInput {
  models: ModelInfo[];
  runner_pubkey_b64: string;
  runner_key_id: string;
  runner_wasm_sha256?: string;
  runtime: "wassette" | "node-unsandboxed";
  wassette_version?: string;
}

export async function registerSeller(agent: AgentRow, input: RegisterSellerInput): Promise<SellerPublic> {
  if (!agent.stripe_account_id && payments().mode === "card") {
    const onboarded = await payments().onboardSeller({ id: agent.id, display_name: agent.display_name });
    if (onboarded.stripe_account_id) {
      unwrap(await db().from("agents").update({ stripe_account_id: onboarded.stripe_account_id }).eq("id", agent.id));
      agent = { ...agent, stripe_account_id: onboarded.stripe_account_id };
    }
  }
  const unknown = input.models.filter((m) => !isAllowlistedModel(m.model_id)).map((m) => m.model_id);
  if (unknown.length) {
    throw new MarketplaceError("MODEL_NOT_ALLOWED", `Models not on the allowlist: ${unknown.join(", ")}.`, {
      next_action: `Advertise only allowlisted models: ${Object.keys(MODEL_ALLOWLIST).join(", ")}.`,
    });
  }
  const min = payments().min_cents;
  const tooCheap = input.models.filter((m) => m.ask_cents < min).map((m) => m.model_id);
  if (tooCheap.length) {
    throw new MarketplaceError("VALIDATION_ERROR", `ask_cents must be at least ${min} (${payments().label}) for: ${tooCheap.join(", ")}.`);
  }
  const patch = {
    models: input.models,
    runner_pubkey_b64: input.runner_pubkey_b64,
    runner_key_id: input.runner_key_id,
    runner_wasm_sha256: input.runner_wasm_sha256 ?? null,
    runtime: input.runtime,
    wassette_version: input.wassette_version ?? null,
    last_seen: nowIso(),
  };
  let rows = unwrap(await db().from("sellers").update(patch).eq("agent_id", agent.id).select()) as SellerRow[];
  if (!rows.length) rows = unwrap(await db().from("sellers").insert({ agent_id: agent.id, ...patch }).select()) as SellerRow[];
  await logEvent("seller.registered", { agent_id: agent.id, meta: { models: input.models.map((m) => m.model_id), runtime: input.runtime } });
  return toSellerPublic(rows[0]!, agent);
}

async function adjustBuyerBalance(buyerId: string, delta: { reserved?: number; spent?: number }): Promise<void> {
  const buyer = await getAgent(buyerId);
  if (!buyer) return;
  unwrap(
    await db()
      .from("agents")
      .update({
        reserved_cents: Math.max(0, buyer.reserved_cents + (delta.reserved ?? 0)),
        spent_cents: Math.max(0, buyer.spent_cents + (delta.spent ?? 0)),
      })
      .eq("id", buyerId),
  );
}

// ---------------------------------------------------------------------------
// Buyer: post / list / read / cancel
// ---------------------------------------------------------------------------

export interface PostTaskInput {
  prompt: string;
  context?: string;
  allowed_models: string[];
  max_price_cents: number;
  max_runtime_s?: number;
  expires_in_s?: number;
  rubric: Rubric;
  max_tokens?: number;
}

export async function postTask(buyer: AgentRow, input: PostTaskInput): Promise<{ task: TaskPublic; payment_note: string; payment_label: string }> {
  const unknown = input.allowed_models.filter((m) => !isAllowlistedModel(m));
  if (unknown.length) {
    throw new MarketplaceError("MODEL_NOT_ALLOWED", `Models not on the allowlist: ${unknown.join(", ")}.`, {
      next_action: `Choose from: ${Object.keys(MODEL_ALLOWLIST).join(", ")} (see marketplace_info).`,
    });
  }
  const min = payments().min_cents;
  if (input.max_price_cents < min) {
    throw new MarketplaceError("VALIDATION_ERROR", `max_price_cents must be at least ${min} (${payments().label}).`);
  }
  const projected = buyer.reserved_cents + buyer.spent_cents + input.max_price_cents;
  if (projected > buyer.spend_cap_cents) {
    throw new MarketplaceError(
      "SPEND_CAP_EXCEEDED",
      `This would bring reserved+spent to ${projected}c, above your cap of ${buyer.spend_cap_cents}c (reserved ${buyer.reserved_cents}c, spent ${buyer.spent_cents}c).`,
      { next_action: "Lower max_price_cents, wait for open tasks to settle, or ask your human to register a buyer with a higher spend_cap_cents." },
    );
  }

  const id = newId("task");
  const max_tokens = input.max_tokens ?? 512;
  const judgePayload: JudgePayload = { task_id: id, prompt: input.prompt, context: input.context, rubric: input.rubric };
  const plaintext: ServerPlaintext = { prompt: input.prompt, context: input.context, rubric: input.rubric, max_tokens };
  const hold = await payments().hold({ id, max_price_cents: input.max_price_cents }, buyer);

  const row = {
    id,
    buyer_id: buyer.id,
    allowed_models: input.allowed_models,
    max_price_cents: input.max_price_cents,
    max_runtime_s: input.max_runtime_s ?? DEFAULT_MAX_RUNTIME_SECONDS,
    status: hold.task_status,
    expires_at: plusSecondsIso(input.expires_in_s ?? DEFAULT_LISTING_TTL_SECONDS),
    plaintext_enc_server: kekSeal(plaintext),
    payload_enc_judge: sealJson(judgeKey(), judgePayload),
    payment_mode: payments().mode,
    payment_state: hold.payment_state,
    stripe_payment_intent_id: hold.stripe_payment_intent_id,
    payment_link: hold.payment_link,
    claim_count: 0,
  };
  const inserted = unwrap(await db().from("tasks").insert(row).select()) as TaskRow[];
  const task = inserted[0]!;
  if (hold.payment_state === "HELD" || hold.payment_state === "MOCK") {
    await adjustBuyerBalance(buyer.id, { reserved: input.max_price_cents });
  }
  await logEvent("task.posted", {
    task_id: id,
    agent_id: buyer.id,
    meta: { allowed_models: input.allowed_models, max_price_cents: input.max_price_cents, rubric_kind: input.rubric.kind, payment_state: hold.payment_state },
  });
  return { task: toTaskPublic(task), payment_note: hold.note, payment_label: payments().label };
}

export async function listTasksForBuyer(buyer: AgentRow, status?: TaskStatus): Promise<TaskPublic[]> {
  await expireStale();
  let q = db().from("tasks").select("*").eq("buyer_id", buyer.id).order("created_at", { ascending: false }).limit(50);
  if (status) q = q.eq("status", status);
  return (unwrap(await q) as TaskRow[]).map(toTaskPublic);
}

export async function getTaskForActor(actor: AgentRow, taskId: string): Promise<{ task: TaskPublic; verdict: Omit<VerdictRow, "replacement_enc_buyer"> | null; settlement: SettlementRow | null }> {
  await expireStale();
  const task = await mustGetTask(taskId);
  if (actor.kind === "buyer" && task.buyer_id !== actor.id) throw new MarketplaceError("FORBIDDEN", "This task belongs to another buyer.");
  if (actor.kind === "seller" && task.seller_id !== actor.id) throw new MarketplaceError("FORBIDDEN", "You do not hold this task's claim.");
  const verdict = await latestVerdict(taskId);
  const settlement = await settlementFor(taskId);
  const publicVerdict = verdict ? (({ replacement_enc_buyer: _r, ...rest }) => rest)(verdict) : null;
  return { task: toTaskPublic(task), verdict: publicVerdict, settlement };
}

export async function getResultForBuyer(buyer: AgentRow, taskId: string) {
  await expireStale();
  const task = await mustGetTask(taskId);
  if (task.buyer_id !== buyer.id) throw new MarketplaceError("FORBIDDEN", "This task belongs to another buyer.");
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
  let replacement_answer: string | null = null;
  if (verdict?.replacement_enc_buyer) {
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
    verdict: verdict ? { verdict: verdict.verdict, reason_code: verdict.reason_code, reason_public: verdict.reason_public, score: verdict.score, created_at: verdict.created_at } : null,
    replacement_answer,
    settlement,
    guidance:
      task.status === "APPROVED"
        ? "Seller result approved by the judge; `answer` is the seller's output."
        : task.status === "REJECTED"
          ? "Seller result rejected; use `replacement_answer` (judge-produced) if present, otherwise post a new task."
          : `Task is ${task.status}; call get_result again later.`,
  };
}

export async function cancelTask(buyer: AgentRow, taskId: string): Promise<TaskPublic> {
  const task = await mustGetTask(taskId);
  if (task.buyer_id !== buyer.id) throw new MarketplaceError("FORBIDDEN", "This task belongs to another buyer.");
  if (task.status !== "OPEN" && task.status !== "AWAITING_PAYMENT") {
    throw new MarketplaceError("INVALID_STATE", `Only OPEN tasks can be cancelled; this one is ${task.status}.`);
  }
  const rel = await payments().release(task, "cancelled by buyer");
  const rows = unwrap(await db().from("tasks").update({ status: "CANCELLED", payment_state: rel.payment_state, plaintext_enc_server: null, updated_at: nowIso() }).eq("id", taskId).eq("status", task.status).select()) as TaskRow[];
  if (!rows.length) throw new MarketplaceError("INVALID_STATE", "Task changed state while cancelling; read it again.");
  await recordSettlement(task, { kind: payments().mode, seller_payout_cents: 0, buyer_refund_cents: task.max_price_cents, note: rel.note });
  await adjustBuyerBalance(buyer.id, { reserved: -task.max_price_cents });
  await logEvent("task.cancelled", { task_id: taskId, agent_id: buyer.id });
  return toTaskPublic(rows[0]!);
}

// ---------------------------------------------------------------------------
// Seller: list / claim / lease / result
// ---------------------------------------------------------------------------

export async function listOpenTasksFor(agent: AgentRow): Promise<{ tasks: (TaskPublic & { eligible_models: string[] })[]; seller_models: string[] }> {
  await expireStale();
  const seller = await getSeller(agent.id);
  const myModels = seller?.models ?? [];
  const rows = unwrap(await db().from("tasks").select("*").eq("status", "OPEN").order("created_at", { ascending: true }).limit(100)) as TaskRow[];
  const tasks = rows
    .map((t) => {
      const eligible = myModels.filter((m) => t.allowed_models.includes(m.model_id) && m.ask_cents <= t.max_price_cents).map((m) => m.model_id);
      return { ...toTaskPublic(t), eligible_models: eligible };
    })
    .filter((t) => myModels.length === 0 || t.eligible_models.length > 0);
  return { tasks, seller_models: myModels.map((m) => m.model_id) };
}

export async function claimTask(agent: AgentRow, taskId: string, modelId: string): Promise<ClaimPublic> {
  await expireStale();
  const seller = await getSeller(agent.id);
  if (!seller?.runner_pubkey_b64 || !seller.runner_key_id) {
    throw new MarketplaceError("INVALID_STATE", "Seller has no runner key registered.", { next_action: "Call register_seller with your runner's public key first." });
  }
  if (seller.status === "SUSPENDED") throw new MarketplaceError("SELLER_SUSPENDED", "This seller is suspended after a rejected result.");
  const task = await mustGetTask(taskId);
  if (task.status !== "OPEN") throw new MarketplaceError("CLAIM_CONFLICT", `Task is ${task.status}, not OPEN.`);
  if (!task.allowed_models.includes(modelId)) {
    throw new MarketplaceError("MODEL_NOT_ALLOWED", `Buyer allows ${task.allowed_models.join(", ")}; ${modelId} is not among them.`);
  }
  const mine = seller.models.find((m) => m.model_id === modelId);
  if (!mine) throw new MarketplaceError("MODEL_NOT_ALLOWED", `${modelId} is not in your registration.`, { next_action: "Call register_seller with your current Ollama models." });
  if (mine.ask_cents > task.max_price_cents) {
    throw new MarketplaceError("MODEL_NOT_ALLOWED", `Your ask of ${mine.ask_cents}c exceeds the buyer's max of ${task.max_price_cents}c.`);
  }
  const active = unwrap(await db().from("tasks").select("id").eq("seller_id", agent.id).in("status", [...ACTIVE_CLAIM_STATUSES]).limit(1)) as { id: string }[];
  if (active.length) throw new MarketplaceError("CLAIM_CONFLICT", `You already hold an active claim (${active[0]!.id}); finish or release it first.`);
  if (!task.plaintext_enc_server) throw new MarketplaceError("INVALID_STATE", "Task payload is no longer available.");

  const claimId = newId("claim");
  const pt = kekOpen<ServerPlaintext>(task.plaintext_enc_server);
  const sellerPayload: SellerPayload = { task_id: task.id, claim_id: claimId, prompt: pt.prompt, context: pt.context, max_tokens: pt.max_tokens };
  const envelope = sealJson({ key_id: seller.runner_key_id, public_key_b64: seller.runner_pubkey_b64 }, sellerPayload);
  const lease = plusSecondsIso(LEASE_SECONDS);
  const rows = unwrap(
    await db()
      .from("tasks")
      .update({
        status: "PAYLOAD_READY",
        claim_id: claimId,
        seller_id: agent.id,
        model_id: modelId,
        price_cents: mine.ask_cents,
        lease_expires_at: lease,
        payload_enc_seller: envelope,
        claim_count: task.claim_count + 1,
        updated_at: nowIso(),
      })
      .eq("id", task.id)
      .eq("status", "OPEN")
      .select(),
  ) as TaskRow[];
  if (!rows.length) throw new MarketplaceError("CLAIM_CONFLICT", "Another seller claimed this task first.", { retryable: true, next_action: "Call list_open_tasks again." });
  unwrap(await db().from("sellers").update({ last_seen: nowIso() }).eq("agent_id", agent.id));
  await logEvent("task.claimed", { task_id: task.id, agent_id: agent.id, meta: { claim_id: claimId, model_id: modelId, price_cents: mine.ask_cents, lease_expires_at: lease } });
  const ctx = await inkbox.notify({ type: "assignment", task_id: task.id, to_handle: agent.inkbox_handle, text: `Task ${task.id} assigned to you (${modelId}, ${mine.ask_cents}c). Lease until ${lease}.`, context_id: task.inkbox_context_id });
  if (ctx && !task.inkbox_context_id) unwrap(await db().from("tasks").update({ inkbox_context_id: ctx }).eq("id", task.id));
  const updated = rows[0]!;
  return {
    claim_id: claimId,
    task_id: task.id,
    seller_id: agent.id,
    model_id: modelId,
    price_cents: mine.ask_cents,
    lease_expires_at: lease,
    seller_envelope: envelope,
    max_runtime_s: updated.max_runtime_s,
  };
}

async function requireLiveClaim(agent: AgentRow, taskId: string, claimId: string): Promise<TaskRow> {
  const task = await mustGetTask(taskId);
  if (task.seller_id !== agent.id || task.claim_id !== claimId) {
    throw new MarketplaceError("LEASE_EXPIRED", "This claim is no longer yours (expired, released, or replaced).", { next_action: "Stop work on it and call list_open_tasks." });
  }
  if (!ACTIVE_CLAIM_STATUSES.includes(task.status)) throw new MarketplaceError("INVALID_STATE", `Task is ${task.status}; the claim is not active.`);
  if (isPast(task.lease_expires_at)) {
    await expireStale();
    throw new MarketplaceError("LEASE_EXPIRED", "Lease expired before this call.", { next_action: "Call list_open_tasks; the task may be OPEN again." });
  }
  return task;
}

export async function recipientKeys(agent: AgentRow, taskId: string, claimId: string): Promise<{ buyer_public_key: KeyDescriptor; judge_public_key: KeyDescriptor }> {
  const task = await requireLiveClaim(agent, taskId, claimId);
  const buyer = await getAgent(task.buyer_id);
  if (!buyer?.buyer_pubkey_b64 || !buyer.buyer_key_id) throw new MarketplaceError("INTERNAL_ERROR", "Buyer has no public key on file.");
  return { buyer_public_key: { key_id: buyer.buyer_key_id, public_key_b64: buyer.buyer_pubkey_b64 }, judge_public_key: judgeKey() };
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
    throw new MarketplaceError("VALIDATION_ERROR", `result_enc_buyer must be encrypted to ${buyer.buyer_key_id}.`);
  }
  if (input.result_enc_judge.recipient_key_id !== env().JUDGE_KEY_ID) {
    throw new MarketplaceError("VALIDATION_ERROR", `result_enc_judge must be encrypted to ${env().JUDGE_KEY_ID}.`);
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
  if (!rows.length) throw new MarketplaceError("INVALID_STATE", "Task left the active state while submitting.");
  unwrap(await db().from("sellers").update({ last_seen: nowIso() }).eq("agent_id", agent.id));
  await logEvent("result.submitted", { task_id: taskId, agent_id: agent.id, meta: { result_id: resultId, runtime_ms: input.runtime_ms, commitment_sha256: input.commitment_sha256 } });
  await inkbox.notify({ type: "submitted", task_id: taskId, to_handle: null, text: `Result for ${taskId} submitted; awaiting judge.`, context_id: task.inkbox_context_id });
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
  await expireStale();
  const candidates = unwrap(await db().from("tasks").select("*").eq("status", "SUBMITTED").order("updated_at", { ascending: true }).limit(5)) as TaskRow[];
  for (const t of candidates) {
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
  reason_public: string;
  score?: number;
  replacement_enc_buyer?: Envelope;
}

export async function submitVerdict(judge: AgentRow, input: SubmitVerdictInput) {
  const task = await mustGetTask(input.task_id);
  const existing = await settlementFor(task.id);
  if (existing) {
    const v = await latestVerdict(task.id);
    return { idempotent: true, task: toTaskPublic(task), verdict: v && { verdict: v.verdict, reason_code: v.reason_code }, settlement: existing, seller_status: null as string | null };
  }
  if (task.status !== "JUDGING" && task.status !== "SUBMITTED") {
    throw new MarketplaceError("INVALID_STATE", `Task is ${task.status}; verdicts apply to JUDGING tasks.`);
  }
  const result = one<ResultRow>(await db().from("results").select("*").eq("id", input.result_id).eq("task_id", task.id).limit(1));
  const res = await result;
  if (!res) throw new MarketplaceError("NOT_FOUND", `Result ${input.result_id} not found for task ${task.id}.`);

  const verdictId = newId("verdict");
  unwrap(
    await db().from("verdicts").insert({
      id: verdictId,
      task_id: task.id,
      result_id: res.id,
      judge_id: judge.id,
      verdict: input.verdict,
      reason_code: input.reason_code,
      reason_public: input.reason_public,
      score: input.score ?? null,
      replacement_enc_buyer: input.replacement_enc_buyer ?? null,
    }),
  );

  const sellerAgent = task.seller_id ? await getAgent(task.seller_id) : null;
  const seller = task.seller_id ? await getSeller(task.seller_id) : null;
  let sellerStatus: string | null = seller?.status ?? null;
  let settlement: SettlementRow;
  let finalStatus: TaskStatus;
  const price = task.price_cents ?? 0;

  if (input.verdict === "APPROVE") {
    const cap = await payments().capture(task, sellerAgent, price);
    settlement = await recordSettlement(task, {
      kind: payments().mode,
      seller_payout_cents: price,
      buyer_refund_cents: task.max_price_cents - price,
      stripe_capture_id: cap.stripe_capture_id,
      stripe_transfer_id: cap.stripe_transfer_id,
      note: cap.note,
    });
    finalStatus = "APPROVED";
    unwrap(await db().from("tasks").update({ status: finalStatus, payment_state: cap.payment_state, updated_at: nowIso() }).eq("id", task.id));
    if (seller) unwrap(await db().from("sellers").update({ approvals: seller.approvals + 1 }).eq("agent_id", seller.agent_id));
    await adjustBuyerBalance(task.buyer_id, { reserved: -task.max_price_cents, spent: price });
  } else {
    const rel = await payments().release(task, "judge rejected result");
    settlement = await recordSettlement(task, { kind: payments().mode, seller_payout_cents: 0, buyer_refund_cents: task.max_price_cents, note: rel.note });
    finalStatus = "REJECTED";
    unwrap(await db().from("tasks").update({ status: finalStatus, payment_state: rel.payment_state, updated_at: nowIso() }).eq("id", task.id));
    if (seller) {
      const strikes = seller.strikes + 1;
      sellerStatus = strikes >= env().SUSPEND_AFTER_STRIKES ? "SUSPENDED" : seller.status;
      unwrap(await db().from("sellers").update({ rejections: seller.rejections + 1, strikes, status: sellerStatus }).eq("agent_id", seller.agent_id));
      if (sellerStatus === "SUSPENDED") await logEvent("seller.suspended", { task_id: task.id, agent_id: seller.agent_id, meta: { strikes, threshold: env().SUSPEND_AFTER_STRIKES } });
    }
    await adjustBuyerBalance(task.buyer_id, { reserved: -task.max_price_cents });
  }
  await logEvent("verdict.recorded", { task_id: task.id, agent_id: judge.id, meta: { verdict: input.verdict, reason_code: input.reason_code, score: input.score ?? null, seller_payout_cents: settlement.seller_payout_cents } });
  const buyer = await getAgent(task.buyer_id);
  await inkbox.notify({ type: "verdict", task_id: task.id, to_handle: buyer?.inkbox_handle ?? null, text: `Judge ${input.verdict} for ${task.id}: ${input.reason_public}`, context_id: task.inkbox_context_id });
  const updated = await mustGetTask(task.id);
  return { idempotent: false, task: toTaskPublic(updated), verdict: { verdict_id: verdictId, verdict: input.verdict, reason_code: input.reason_code }, settlement, seller_status: sellerStatus };
}

// ---------------------------------------------------------------------------
// Settlement + expiry
// ---------------------------------------------------------------------------

async function recordSettlement(task: TaskRow, s: { kind: string; seller_payout_cents: number; buyer_refund_cents: number; stripe_capture_id?: string | null; stripe_transfer_id?: string | null; note?: string | null }): Promise<SettlementRow> {
  const existing = await settlementFor(task.id);
  if (existing) return existing;
  const rows = unwrap(
    await db().from("settlements").insert({
      id: newId("settle"),
      task_id: task.id,
      kind: s.kind === "card" ? "STRIPE_TEST" : s.kind.toUpperCase(),
      state: "RECORDED",
      seller_payout_cents: s.seller_payout_cents,
      buyer_refund_cents: s.buyer_refund_cents,
      stripe_capture_id: s.stripe_capture_id ?? null,
      stripe_transfer_id: s.stripe_transfer_id ?? null,
      note: s.note ?? null,
    }).select(),
  ) as SettlementRow[];
  return rows[0]!;
}

async function finalizeExpired(task: TaskRow, reason: string): Promise<TaskRow> {
  const rel = task.payment_state === "HELD" || task.payment_state === "MOCK" ? await payments().release(task, reason) : null;
  const rows = unwrap(
    await db()
      .from("tasks")
      .update({ status: "EXPIRED", payment_state: rel?.payment_state ?? task.payment_state, plaintext_enc_server: null, payload_enc_seller: null, claim_id: null, seller_id: null, lease_expires_at: null, updated_at: nowIso() })
      .eq("id", task.id)
      .eq("status", task.status)
      .select(),
  ) as TaskRow[];
  if (!rows.length) return task;
  await recordSettlement(task, { kind: payments().mode, seller_payout_cents: 0, buyer_refund_cents: task.max_price_cents, note: `expired: ${reason}` });
  await adjustBuyerBalance(task.buyer_id, { reserved: -task.max_price_cents });
  await logEvent("task.expired", { task_id: task.id, meta: { reason, previous_status: task.status } });
  return rows[0]!;
}

async function reopen(task: TaskRow, reason: string): Promise<TaskRow> {
  const rows = unwrap(
    await db()
      .from("tasks")
      .update({ status: "OPEN", claim_id: null, seller_id: null, model_id: null, price_cents: null, lease_expires_at: null, payload_enc_seller: null, updated_at: nowIso() })
      .eq("id", task.id)
      .eq("claim_id", task.claim_id)
      .select(),
  ) as TaskRow[];
  if (rows.length) await logEvent("task.reopened", { task_id: task.id, meta: { reason, previous_claim_id: task.claim_id, previous_seller_id: task.seller_id } });
  return rows[0] ?? task;
}

export async function expireStale(): Promise<{ expired: number; reopened: number; requeued: number }> {
  const now = nowIso();
  let expired = 0, reopened = 0, requeued = 0;
  const deadListings = unwrap(await db().from("tasks").select("*").in("status", ["OPEN", "AWAITING_PAYMENT"]).lt("expires_at", now).limit(50)) as TaskRow[];
  for (const t of deadListings) { await finalizeExpired(t, "listing deadline passed"); expired++; }
  const deadLeases = unwrap(await db().from("tasks").select("*").in("status", [...ACTIVE_CLAIM_STATUSES]).lt("lease_expires_at", now).limit(50)) as TaskRow[];
  for (const t of deadLeases) {
    if (isPast(t.expires_at)) { await finalizeExpired(t, "lease expired after listing deadline"); expired++; }
    else { await reopen(t, "lease expired"); reopened++; }
  }
  const stuck = unwrap(await db().from("tasks").select("*").eq("status", "JUDGING").lt("updated_at", new Date(Date.now() - JUDGING_TIMEOUT_S * 1000).toISOString()).limit(20)) as TaskRow[];
  for (const t of stuck) {
    unwrap(await db().from("tasks").update({ status: "SUBMITTED", judge_id: null, updated_at: nowIso() }).eq("id", t.id).eq("status", "JUDGING"));
    requeued++;
  }
  return { expired, reopened, requeued };
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
  if (!s || !a) throw new MarketplaceError("NOT_FOUND", `Unknown seller ${sellerId}.`);
  return toSellerPublic(s, a);
}

export async function dashboard() {
  await expireStale();
  const tasks = (unwrap(await db().from("tasks").select("*").order("created_at", { ascending: false }).limit(40)) as TaskRow[]).map(toTaskPublic);
  const sellers = await listSellers();
  const events = unwrap(await db().from("events").select("*").order("created_at", { ascending: false }).limit(60));
  const verdicts = (unwrap(await db().from("verdicts").select("id,task_id,verdict,reason_code,reason_public,score,created_at").order("created_at", { ascending: false }).limit(40)) as Omit<VerdictRow, "replacement_enc_buyer" | "judge_id" | "result_id">[]);
  const settlements = unwrap(await db().from("settlements").select("*").order("created_at", { ascending: false }).limit(40)) as SettlementRow[];
  const counts = await rawSql<{ status: string; n: number }>("select status, count(*)::int as n from tasks group by status");
  return {
    generated_at: nowIso(),
    payments: { mode: payments().mode, label: payments().label },
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    tasks,
    sellers,
    verdicts,
    settlements,
    events,
  };
}
