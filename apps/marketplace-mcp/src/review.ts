/**
 * Judge review deferral (contract §8.2) and replacement delivery (§8.3).
 * Neither path moves money or changes reputation: a deferral leaves the task
 * reviewable, and a replacement is delivered after the REJECT already settled.
 */
import {
  MAX_REPLACEMENT_ATTEMPTS,
  MAX_REVIEW_ATTEMPTS,
  MarketplaceError,
  isInfraReason,
  nowIso,
  plusSecondsIso,
  retryDelaySeconds,
  type Envelope,
  type KeyDescriptor,
  type ReviewStatus,
} from "@atm/shared";
import { db, logEvent, one, unwrap, type AgentRow, type TaskRow, type VerdictRow } from "./db.js";
import { notifyTask } from "./notices.js";

/** Replacement work is leased to one judge at a time for this long. */
export const REPLACEMENT_LEASE_S = 300;

export interface ReviewState {
  status: ReviewStatus;
  attempts: number;
  retry_at: string | null;
}

/** The review state shown on TaskPublic, derived for rows written before v0.3. */
export function reviewOf(t: TaskRow): ReviewState {
  const derived: ReviewStatus =
    t.status === "APPROVED" || t.status === "REJECTED" ? "FINAL" : t.status === "SUBMITTED" || t.status === "JUDGING" ? "PENDING" : "NOT_SUBMITTED";
  const stored = t.review_status as ReviewStatus | null | undefined;
  const status = stored && !(stored === "FINAL" && derived !== "FINAL") ? stored : derived;
  return { status, attempts: t.review_attempts ?? 0, retry_at: status === "RETRY_PENDING" || status === "JUDGE_UNAVAILABLE" ? t.review_retry_at ?? null : null };
}

/** A judge infrastructure failure: no verdict, no settlement, no strike; retry later (§8.2). */
export async function deferReview(judge: AgentRow, task: TaskRow, reasonCode: string): Promise<{ task: TaskRow; review: ReviewState }> {
  if (!isInfraReason(reasonCode)) throw new Error(`deferReview called with quality code ${reasonCode}`);
  const attempts = (task.review_attempts ?? 0) + 1;
  const status: ReviewStatus = attempts >= MAX_REVIEW_ATTEMPTS ? "JUDGE_UNAVAILABLE" : "RETRY_PENDING";
  const retryAt = plusSecondsIso(retryDelaySeconds(attempts));
  const rows = unwrap(
    await db()
      .from("tasks")
      .update({ status: "SUBMITTED", judge_id: null, review_status: status, review_attempts: attempts, review_retry_at: retryAt, updated_at: nowIso() })
      .eq("id", task.id)
      .in("status", ["SUBMITTED", "JUDGING"])
      .select(),
  ) as TaskRow[];
  if (!rows.length) {
    throw new MarketplaceError("INVALID_STATE", "Task left review while the deferral was recorded.", { next_action: "Call fetch_review_package for the next task waiting for review." });
  }
  await logEvent("review.deferred", { task_id: task.id, agent_id: judge.id, meta: { reason_code: reasonCode, attempts, review_status: status, retry_at: retryAt } });
  return { task: rows[0]!, review: reviewOf(rows[0]!) };
}

/** True when fetch_review_package may hand this SUBMITTED task out now. */
export function reviewDue(t: TaskRow, now = Date.now()): boolean {
  return !t.review_retry_at || Date.parse(t.review_retry_at) <= now;
}

async function latestVerdict(taskId: string): Promise<VerdictRow | null> {
  return one<VerdictRow>(await db().from("verdicts").select("*").eq("task_id", taskId).order("created_at", { ascending: false }).limit(1));
}

async function buyerKey(task: TaskRow): Promise<{ buyer: AgentRow; key: KeyDescriptor } | null> {
  const buyer = await one<AgentRow>(await db().from("agents").select("*").eq("id", task.buyer_id).limit(1));
  if (!buyer?.buyer_pubkey_b64 || !buyer.buyer_key_id) return null;
  return { buyer, key: { key_id: buyer.buyer_key_id, public_key_b64: buyer.buyer_pubkey_b64 } };
}

export interface ReplacementPackage {
  task_id: string;
  result_id: string;
  payload_enc_judge: Envelope;
  buyer_public_key: KeyDescriptor;
  attempts: number;
}

/** Lease the oldest REJECTED task whose replacement answer is still pending (§8.3). */
export async function fetchReplacementPackage(judge: AgentRow): Promise<ReplacementPackage | null> {
  const now = Date.now();
  const candidates = (unwrap(await db().from("tasks").select("*").eq("status", "REJECTED").eq("replacement_status", "PENDING").order("updated_at", { ascending: true }).limit(25)) as TaskRow[])
    .filter((t) => !t.replacement_retry_at || Date.parse(t.replacement_retry_at) <= now);
  for (const t of candidates) {
    // The lease is the guard: a judge that read the same row loses this update.
    const leased = unwrap(
      await db()
        .from("tasks")
        .update({ replacement_retry_at: plusSecondsIso(REPLACEMENT_LEASE_S), updated_at: nowIso() })
        .eq("id", t.id)
        .eq("replacement_status", "PENDING")
        .eq("updated_at", t.updated_at)
        .select(),
    ) as TaskRow[];
    if (!leased.length) continue;
    const verdict = await latestVerdict(t.id);
    const keys = await buyerKey(t);
    if (!verdict || !t.payload_enc_judge || !keys) {
      unwrap(await db().from("tasks").update({ replacement_status: "UNAVAILABLE", replacement_retry_at: null, updated_at: nowIso() }).eq("id", t.id));
      await logEvent("replacement.unavailable", { task_id: t.id, agent_id: judge.id, meta: { reason: "missing judge payload, verdict or buyer key" } });
      continue;
    }
    return { task_id: t.id, result_id: verdict.result_id, payload_enc_judge: t.payload_enc_judge, buyer_public_key: keys.key, attempts: t.replacement_attempts ?? 0 };
  }
  return null;
}

export interface SubmitReplacementInput {
  task_id: string;
  result_id: string;
  replacement_enc_buyer?: Envelope;
  reason_code?: string;
}

export async function submitReplacement(judge: AgentRow, input: SubmitReplacementInput) {
  const t = await one<TaskRow>(await db().from("tasks").select("*").eq("id", input.task_id).limit(1));
  if (!t) throw new MarketplaceError("NOT_FOUND", `Unknown task ${input.task_id}.`, { next_action: "Use the task_id from fetch_replacement_package." });
  if (t.status !== "REJECTED") throw new MarketplaceError("INVALID_STATE", `Task is ${t.status}; replacements apply to REJECTED tasks.`, { next_action: "Call fetch_replacement_package for pending work." });
  const verdict = await latestVerdict(t.id);
  if (!verdict || verdict.result_id !== input.result_id) {
    throw new MarketplaceError("VALIDATION_ERROR", "result_id does not match the task's verdict.", { next_action: "Use the result_id from fetch_replacement_package." });
  }
  if (t.replacement_status === "DELIVERED") return { idempotent: true, replacement_status: "DELIVERED" as const, attempts: t.replacement_attempts ?? 0 };
  if (t.replacement_status !== "PENDING") {
    throw new MarketplaceError("INVALID_STATE", `Replacement is ${t.replacement_status ?? "not pending"}.`, { next_action: "Call fetch_replacement_package for pending work." });
  }

  if (input.replacement_enc_buyer) {
    const keys = await buyerKey(t);
    if (!keys || input.replacement_enc_buyer.recipient_key_id !== keys.key.key_id) {
      throw new MarketplaceError("VALIDATION_ERROR", `replacement_enc_buyer must be sealed to ${keys?.key.key_id ?? "the buyer's key"}.`, { next_action: "Seal to buyer_public_key from fetch_replacement_package and resubmit." });
    }
    unwrap(await db().from("verdicts").update({ replacement_enc_buyer: input.replacement_enc_buyer }).eq("id", verdict.id));
    const rows = unwrap(
      await db().from("tasks").update({ replacement_status: "DELIVERED", replacement_retry_at: null, updated_at: nowIso() }).eq("id", t.id).eq("replacement_status", "PENDING").select(),
    ) as TaskRow[];
    if (!rows.length) return { idempotent: true, replacement_status: "DELIVERED" as const, attempts: t.replacement_attempts ?? 0 };
    await logEvent("replacement.delivered", { task_id: t.id, agent_id: judge.id, meta: { attempts: t.replacement_attempts ?? 0 } });
    await notifyTask(rows[0]!, { type: "replacement", to_handle: keys.buyer.inkbox_handle ?? null, text: `A judge-produced answer for ${t.id} is ready; call get_result.` });
    return { idempotent: false, replacement_status: "DELIVERED" as const, attempts: t.replacement_attempts ?? 0 };
  }

  if (!input.reason_code || !isInfraReason(input.reason_code)) {
    throw new MarketplaceError("VALIDATION_ERROR", "Send replacement_enc_buyer, or a judge infrastructure reason_code when the model could not produce one.", {
      next_action: "Retry with replacement_enc_buyer, or reason_code JUDGE_UNAVAILABLE / JUDGE_TIMEOUT / JUDGE_MALFORMED.",
    });
  }
  const attempts = (t.replacement_attempts ?? 0) + 1;
  const status = attempts >= MAX_REPLACEMENT_ATTEMPTS ? "UNAVAILABLE" : "PENDING";
  const retryAt = status === "PENDING" ? plusSecondsIso(retryDelaySeconds(attempts)) : null;
  unwrap(await db().from("tasks").update({ replacement_status: status, replacement_attempts: attempts, replacement_retry_at: retryAt, updated_at: nowIso() }).eq("id", t.id).eq("replacement_status", "PENDING"));
  await logEvent(status === "UNAVAILABLE" ? "replacement.unavailable" : "replacement.deferred", { task_id: t.id, agent_id: judge.id, meta: { reason_code: input.reason_code, attempts, retry_at: retryAt } });
  return { idempotent: false, replacement_status: status, attempts, retry_at: retryAt };
}
