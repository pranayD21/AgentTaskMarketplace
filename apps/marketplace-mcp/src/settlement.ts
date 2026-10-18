/**
 * Durable settlement (contract §9). A settlement row records the decision
 * before any money moves; finalizeSettlement() then applies each effect so
 * that a retry or a sweep after a crash finishes the same decision exactly
 * once:
 *   money       Stripe calls reuse task-scoped idempotency keys (payments.ts)
 *   verdict     inserted only if the task has none
 *   task        guarded transition (SUBMITTED/JUDGING → final, or settle_pending)
 *   reputation  recomputed from final verdicts, never incremented
 *   balances    keyed compare-and-swap (`settle:<task>`), buyer and job
 *   finalized   `finalized_at` set by the one call that wins the guard
 */
import { randomUUID } from "node:crypto";
import { MarketplaceError, isInfraReason, nowIso, plusSecondsIso, publicReason, retryDelaySeconds, type Envelope, type TaskStatus } from "@atm/shared";
import {
  adjustBuyerBalance,
  adjustJobBudget,
  db,
  logEvent,
  one,
  unwrap,
  type AgentRow,
  type SellerRow,
  type SettlementDecision,
  type SettlementRow,
  type TaskRow,
  type VerdictRow,
} from "./db.js";
import { env } from "./env.js";
import { newId } from "./ids.js";
import { notifyTask } from "./notices.js";
import { payments } from "./payments.js";

export type Outcome = "APPROVE" | "REJECT" | "CANCEL" | "EXPIRE";

const FINAL_STATUS: Record<Outcome, TaskStatus> = { APPROVE: "APPROVED", REJECT: "REJECTED", CANCEL: "CANCELLED", EXPIRE: "EXPIRED" };
/** Payment states in which post_task (or an mpp payment) reserved the buyer's budget. */
const RESERVED_PAYMENT_STATES = ["HELD", "MOCK", "PAID"];
/** Unfinished settlements older than this are resumed by the sweep. */
export const RESUME_AFTER_S = 120;
const REPUTATION_CAS_ATTEMPTS = 8;

async function taskRow(id: string): Promise<TaskRow | null> {
  return one<TaskRow>(await db().from("tasks").select("*").eq("id", id).limit(1));
}

export async function settlementOf(taskId: string): Promise<SettlementRow | null> {
  return one<SettlementRow>(await db().from("settlements").select("*").eq("task_id", taskId).limit(1));
}

async function verdictOf(taskId: string): Promise<VerdictRow | null> {
  return one<VerdictRow>(await db().from("verdicts").select("*").eq("task_id", taskId).order("created_at", { ascending: false }).limit(1));
}

export function outcomeForStatus(status: TaskStatus): Outcome | null {
  return status === "CANCELLED" ? "CANCEL" : status === "EXPIRED" ? "EXPIRE" : null;
}

export interface IntentInput {
  outcome: Outcome;
  seller_payout_cents: number;
  result_id?: string | null;
  reason_code?: string | null;
  judge_id?: string | null;
  score?: number | null;
  replacement_enc_buyer?: Envelope | null;
  release_reason?: string | null;
}

/** Record the decision before money moves. One per task: a second call returns the first decision. */
export async function recordIntent(task: TaskRow, input: IntentInput): Promise<{ settlement: SettlementRow; created: boolean }> {
  const existing = await settlementOf(task.id);
  if (existing) return { settlement: existing, created: false };
  const decision: SettlementDecision = {
    judge_id: input.judge_id ?? null,
    score: input.score ?? null,
    replacement_enc_buyer: input.replacement_enc_buyer ?? null,
    prior_payment_state: task.payment_state,
    release_reserved_cents: RESERVED_PAYMENT_STATES.includes(task.payment_state) ? task.max_price_cents : 0,
    release_reason: input.release_reason ?? null,
  };
  const payout = input.seller_payout_cents;
  try {
    const rows = unwrap(
      await db().from("settlements").insert({
        id: newId("settle"),
        task_id: task.id,
        kind: task.payment_mode === "card" ? "STRIPE_TEST" : task.payment_mode.toUpperCase(),
        state: "PENDING",
        outcome: input.outcome,
        result_id: input.result_id ?? null,
        verdict_reason_code: input.reason_code ?? null,
        decision,
        seller_payout_cents: payout,
        buyer_refund_cents: task.max_price_cents - payout,
        payout_owed_cents: payout,
        payout_transferred_cents: 0,
        transfer_state: payout > 0 ? "PENDING" : "NOT_APPLICABLE",
        updated_at: nowIso(),
      }).select(),
    ) as SettlementRow[];
    return { settlement: rows[0]!, created: true };
  } catch (err) {
    // Unique task_id: a concurrent caller recorded its decision first; follow that one.
    const winner = await settlementOf(task.id);
    if (winner) return { settlement: winner, created: false };
    throw err;
  }
}

async function moveMoney(task: TaskRow, s: SettlementRow, d: SettlementDecision): Promise<Partial<SettlementRow>> {
  try {
    if (s.outcome === "APPROVE") {
      const seller = task.seller_id ? await one<AgentRow>(await db().from("agents").select("*").eq("id", task.seller_id).limit(1)) : null;
      const cap = await payments().capture(task, seller, s.seller_payout_cents);
      const owed = s.seller_payout_cents;
      const transferred = cap.transferred_cents;
      return {
        payment_state: cap.payment_state,
        stripe_capture_id: cap.stripe_capture_id,
        stripe_transfer_id: cap.stripe_transfer_id,
        note: cap.note,
        payout_transferred_cents: transferred,
        transfer_state: cap.transfer_state,
        transfer_pending_reason: cap.pending_reason ?? null,
        transfer_manual_review: cap.pending_reason === "MISMATCH",
        transfer_retry_safe_to_advance: cap.transfer_retry_safe_to_advance === true,
        transfer_key_created_at: s.created_at,
      };
    }
    // A REJECT always follows a hold; CANCEL lets the rail decide; EXPIRE releases only what was reserved.
    const holds = s.outcome !== "EXPIRE" || RESERVED_PAYMENT_STATES.includes(d.prior_payment_state);
    if (!holds) return { payment_state: task.payment_state, note: `nothing to release (${d.prior_payment_state})` };
    const reason = d.release_reason ?? (s.outcome === "REJECT" ? "judge rejected result" : s.outcome === "CANCEL" ? "cancelled by buyer" : "listing or lease expired");
    const rel = await payments().release(task, reason);
    return { payment_state: rel.payment_state, note: rel.note };
  } catch (err) {
    throw new MarketplaceError("PAYMENT_FAILED", "The payment provider did not confirm this settlement. The decision is recorded and will be retried.", {
      retryable: true,
      next_action: "Retry the same call later, or let housekeeping (expire_stale) resume it; the recorded decision will not change.",
    });
  }
}

/**
 * Recompute a seller's counters from its final verdicts (contract §9). Judge
 * infrastructure codes never count. Suspension is applied, never lifted, here.
 */
export async function recomputeReputation(sellerId: string): Promise<string | null> {
  for (let attempt = 0; attempt < REPUTATION_CAS_ATTEMPTS; attempt++) {
    const cur = await one<SellerRow>(await db().from("sellers").select("*").eq("agent_id", sellerId).limit(1));
    if (!cur) return null;
    const verdicts = unwrap(await db().from("verdicts").select("task_id,verdict,reason_code").eq("seller_id", sellerId).limit(10_000)) as Pick<VerdictRow, "task_id" | "verdict" | "reason_code">[];
    const decisions = [...new Map(verdicts.map((v) => [v.task_id, v])).values()];
    const approvals = decisions.filter((v) => v.verdict === "APPROVE").length;
    const rejections = decisions.filter((v) => v.verdict === "REJECT" && !isInfraReason(v.reason_code)).length;
    const strikes = rejections;
    const status = cur.status === "SUSPENDED" || strikes >= env().SUSPEND_AFTER_STRIKES ? "SUSPENDED" : cur.status;
    if (approvals === cur.approvals && rejections === cur.rejections && strikes === cur.strikes && status === cur.status) return status;
    const rows = unwrap(
      await db()
        .from("sellers")
        .update({ approvals, rejections, strikes, status })
        .eq("agent_id", sellerId)
        .eq("approvals", cur.approvals)
        .eq("rejections", cur.rejections)
        .eq("strikes", cur.strikes)
        .select(),
    ) as SellerRow[];
    if (rows.length) {
      if (status === "SUSPENDED" && cur.status !== "SUSPENDED") await logEvent("seller.suspended", { agent_id: sellerId, meta: { strikes, threshold: env().SUSPEND_AFTER_STRIKES } });
      return status;
    }
  }
  throw new MarketplaceError("INTERNAL_ERROR", "Seller reputation kept changing under concurrent calls.", { retryable: true });
}

export interface Finalized {
  settlement: SettlementRow;
  task: TaskRow;
  /** True for the one call that completed the settlement (events and notices are sent once). */
  finishedNow: boolean;
  sellerStatus: string | null;
}

/** Apply every effect of the recorded decision. Safe to repeat and to run concurrently. */
export async function finalizeSettlement(taskId: string): Promise<Finalized> {
  let s = await settlementOf(taskId);
  let task = await taskRow(taskId);
  if (!s || !task) throw new MarketplaceError("NOT_FOUND", `No settlement decision for ${taskId}.`, { next_action: "Call get_task to see its state." });
  if (!s.outcome) return { settlement: s, task, finishedNow: false, sellerStatus: null }; // pre-v0.3 row, already final
  const outcome = s.outcome;
  const d: SettlementDecision = s.decision ?? { prior_payment_state: task.payment_state, release_reserved_cents: 0 };

  // 1. money (idempotent at Stripe)
  if (s.state === "PENDING") {
    const patch = await moveMoney(task, s, d);
    const rows = unwrap(await db().from("settlements").update({ ...patch, state: "RECORDED", updated_at: nowIso() }).eq("id", s.id).eq("state", "PENDING").select()) as SettlementRow[];
    s = rows[0] ?? (await settlementOf(taskId))!;
  }

  // 2. the verdict row, with the server's public reason
  const quality = outcome === "APPROVE" || outcome === "REJECT";
  if (quality && !(await verdictOf(taskId))) {
    try { unwrap(
      await db().from("verdicts").insert({
        id: `verdict_${s.id}`,
        task_id: taskId,
        result_id: s.result_id,
        judge_id: d.judge_id ?? "unknown",
        seller_id: task.seller_id,
        verdict: outcome,
        reason_code: s.verdict_reason_code,
        reason_public: publicReason(s.verdict_reason_code ?? ""),
        score: d.score ?? null,
        replacement_enc_buyer: d.replacement_enc_buyer ?? null,
      }),
    ); } catch (error) {
      if (!(await verdictOf(taskId))) throw error;
    }
  }

  // 3. the task's final state
  const base = { payment_state: s.payment_state ?? task.payment_state, settle_pending: false, plaintext_enc_server: null, payload_enc_seller: null, updated_at: nowIso() };
  const moved = quality
    ? (unwrap(
        await db()
          .from("tasks")
          .update({
            ...base,
            status: FINAL_STATUS[outcome],
            review_status: "FINAL",
            review_retry_at: null,
            replacement_status: outcome === "APPROVE" ? "NOT_NEEDED" : d.replacement_enc_buyer ? "DELIVERED" : "PENDING",
            replacement_retry_at: null,
          })
          .eq("id", taskId)
          .in("status", ["SUBMITTED", "JUDGING"])
          .select(),
      ) as TaskRow[])
    : (unwrap(await db().from("tasks").update(base).eq("id", taskId).is("settle_pending", true).select()) as TaskRow[]);
  task = moved[0] ?? (await taskRow(taskId))!;

  // 4. reputation
  const sellerStatus = quality && task.seller_id ? await recomputeReputation(task.seller_id) : null;

  // 5. balances, once each
  const delta = outcome === "APPROVE" ? { reserved: -d.release_reserved_cents, spent: s.seller_payout_cents } : { reserved: -d.release_reserved_cents };
  if (delta.reserved || ("spent" in delta && delta.spent)) {
    await adjustBuyerBalance(task.buyer_id, delta, { key: `settle:${taskId}` });
    if (task.job_id) await adjustJobBudget(task.job_id, delta, { key: `settle:${taskId}` });
  }

  // 6. done: exactly one caller wins this guard
  const fin = unwrap(await db().from("settlements").update({ finalized_at: nowIso(), updated_at: nowIso() }).eq("id", s.id).is("finalized_at", null).select()) as SettlementRow[];
  const finishedNow = fin.length > 0;
  if (finishedNow) {
    s = fin[0]!;
    await logEvent(quality ? "verdict.recorded" : `task.${outcome === "CANCEL" ? "cancelled" : "expired"}.settled`, {
      task_id: taskId,
      agent_id: d.judge_id ?? null,
      meta: { outcome, reason_code: s.verdict_reason_code, seller_payout_cents: s.seller_payout_cents, transfer_state: s.transfer_state },
    });
    if (quality) {
      const buyer = await one<AgentRow>(await db().from("agents").select("*").eq("id", task.buyer_id).limit(1));
      await notifyTask(task, { type: "verdict", to_handle: buyer?.inkbox_handle ?? null, text: `Judge ${outcome} for ${taskId}: ${publicReason(s.verdict_reason_code ?? "")}` });
    }
  }
  return { settlement: s, task, finishedNow, sellerStatus };
}

/**
 * Transfer retries (contract §9, P2). Runs only when the payment provider
 * implements the optional retryTransfer (D); otherwise the PENDING state stays
 * visible and truthful.
 */
export async function retryPendingTransfers(limit = 10): Promise<{ attempted: number; transferred: number }> {
  const provider = payments();
  const retry = provider.retryTransfer?.bind(provider);
  if (!retry) return { attempted: 0, transferred: 0 };
  const now = Date.now();
  const due = (unwrap(await db().from("settlements").select("*").eq("transfer_state", "PENDING").order("created_at", { ascending: true }).limit(limit * 3)) as SettlementRow[])
    .filter((s) => s.finalized_at && !s.transfer_manual_review && (!s.transfer_retry_at || Date.parse(s.transfer_retry_at) <= now) && (!s.transfer_lease_until || Date.parse(s.transfer_lease_until) <= now))
    .slice(0, limit);
  let attempted = 0, transferred = 0;
  for (const s of due) {
    const safeAdvance = s.transfer_retry_safe_to_advance === true;
    const keyCreated = s.transfer_key_created_at ?? s.created_at;
    if (!safeAdvance && now - Date.parse(keyCreated) > 23 * 3600_000) {
      unwrap(await db().from("settlements").update({ transfer_manual_review: true, transfer_pending_reason: "IDEMPOTENCY_WINDOW", note: "Unknown transfer outcome is older than the safe replay window; operator reconciliation required." }).eq("id", s.id).eq("transfer_state", "PENDING"));
      continue;
    }
    const attempts = (s.transfer_attempts ?? 0) + 1;
    const keyAttempt = (s.transfer_key_attempt ?? 0) + (safeAdvance ? 1 : 0);
    const token = randomUUID();
    let q = db().from("settlements").update({
      transfer_attempts: attempts, transfer_key_attempt: keyAttempt,
      transfer_key_created_at: safeAdvance ? nowIso() : keyCreated,
      transfer_retry_safe_to_advance: false, transfer_lease_token: token,
      transfer_lease_until: plusSecondsIso(300), updated_at: nowIso(),
    }).eq("id", s.id).eq("transfer_state", "PENDING").eq("transfer_attempts", s.transfer_attempts ?? 0);
    q = s.transfer_lease_token ? q.eq("transfer_lease_token", s.transfer_lease_token) : q.is("transfer_lease_token", null);
    const claimed = unwrap(await q.select()) as SettlementRow[];
    if (!claimed.length) continue;
    attempted++;
    const task = await taskRow(s.task_id);
    if (!task) continue;
    const seller = task.seller_id ? await one<AgentRow>(await db().from("agents").select("*").eq("id", task.seller_id).limit(1)) : null;
    const owed = s.payout_owed_cents ?? s.seller_payout_cents;
    let r: Awaited<ReturnType<typeof retry>>;
    try { r = await retry(task, seller, owed, { attempt: keyAttempt, known_transfer_id: s.stripe_transfer_id }); }
    catch { r = { transfer_id: null, state: "PENDING", amount_cents: 0, pending_reason: "PROVIDER_ERROR", retry_safe_to_advance: false, note: "Transfer outcome unknown; the same idempotency key will be reused." }; }
    const paid = r.state === "TRANSFERRED" && !!r.transfer_id && r.amount_cents === owed;
    const mismatch = r.pending_reason === "MISMATCH" || (!!r.transfer_id && !paid);
    const patch = {
      transfer_state: paid ? "TRANSFERRED" : "PENDING",
      stripe_transfer_id: paid ? r.transfer_id : s.stripe_transfer_id,
      payout_transferred_cents: paid ? r.amount_cents : s.payout_transferred_cents ?? 0,
      transfer_retry_at: paid || mismatch ? null : plusSecondsIso(retryDelaySeconds(attempts)),
      transfer_lease_token: null, transfer_lease_until: null,
      transfer_retry_safe_to_advance: !mismatch && r.retry_safe_to_advance === true,
      transfer_manual_review: mismatch, transfer_pending_reason: mismatch ? "MISMATCH" : r.pending_reason ?? null,
      note: r.note.slice(0, 1000), updated_at: nowIso(),
    };
    const saved = unwrap(await db().from("settlements").update(patch).eq("id", s.id).eq("transfer_state", "PENDING").eq("transfer_lease_token", token).select()) as SettlementRow[];
    if (paid && saved.length) {
      transferred++;
      await logEvent("settlement.transferred", { task_id: s.task_id, meta: { attempts, amount_cents: r.amount_cents } });
    }
  }
  return { attempted, transferred };
}
