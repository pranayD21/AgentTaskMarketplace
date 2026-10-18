/** Durable task posting: the task and its reservation exist before a payment request. */
import { MarketplaceError, nowIso } from "@atm/shared";
import { adjustBuyerBalance, adjustJobBudget, db, one, unwrap, type AgentRow, type TaskRow } from "./db.js";
import { payments, type HoldResult } from "./payments.js";

async function read(id: string) { return one<TaskRow>(await db().from("tasks").select("*").eq("id", id).limit(1)); }

/** Safe to resume after a lost provider or database response with the same task id. */
export async function finishPost(original: TaskRow, buyer: AgentRow): Promise<TaskRow> {
  let task = (await read(original.id))!;
  if (task.post_state !== "HOLDING") return task;
  if (task.payment_mode !== payments().mode) throw new MarketplaceError("PAYMENT_FAILED", "Posting requires its original payment rail.", { retryable: true, next_action: "The operator must restore the original rail before resuming this task." });
  let hold = task.post_hold as HoldResult | null;
  try {
    if (!hold) hold = await payments().hold(task, buyer);
  } catch (error) {
    // Only an explicit definitive rejection permits releasing the reservation.
    if ((error as { hold_outcome?: string }).hold_outcome === "not_created") {
      await cancelPosting(task, buyer, null, true);
    }
    throw new MarketplaceError("PAYMENT_FAILED", "The post is recorded but the payment outcome is not confirmed.", { retryable: true, next_action: `Inspect get_task('${task.id}') or repeat the same client_request_id. Do not create another purchase; housekeeping resumes the recorded post.` });
  }
  // Publishing and cancellation compete on the same state. A cancelled post
  // can never become claimable when a slow hold request returns.
  const rows = unwrap(await db().from("tasks").update({
    post_hold: hold, post_state: "READY", status: hold.task_status, payment_state: hold.payment_state,
    stripe_payment_intent_id: hold.stripe_payment_intent_id, payment_link: hold.payment_link, updated_at: nowIso(),
  }).eq("id", task.id).eq("post_state", "HOLDING").select()) as TaskRow[];
  if (rows.length) return rows[0]!;
  task = (await read(task.id))!;
  if (task.post_state === "CANCEL_PENDING") return cancelPosting(task, buyer, hold);
  return task;
}

/** Close first, then undo a possibly accepted hold; retries keep the same idempotency key. */
export async function cancelPosting(task: TaskRow, buyer: AgentRow, suppliedHold?: HoldResult | null, definitivelyNoHold = false): Promise<TaskRow> {
  if (task.post_state === "HOLDING") {
    const closed = unwrap(await db().from("tasks").update({ status: "CANCELLED", post_state: "CANCEL_PENDING", plaintext_enc_server: null, payload_enc_judge: null, updated_at: nowIso() }).eq("id", task.id).eq("post_state", "HOLDING").select()) as TaskRow[];
    task = closed[0] ?? (await read(task.id))!;
  }
  if (task.post_state !== "CANCEL_PENDING") return task;
  let hold = suppliedHold ?? task.post_hold as HoldResult | null;
  if (!hold && !definitivelyNoHold) {
    if (task.payment_mode !== payments().mode) throw new Error("POST_RAIL_UNAVAILABLE");
    try { hold = await payments().hold(task, buyer); }
    catch (error) { if ((error as { hold_outcome?: string }).hold_outcome !== "not_created") throw error; }
  }
  if (hold) {
    unwrap(await db().from("tasks").update({ post_hold: hold, stripe_payment_intent_id: hold.stripe_payment_intent_id }).eq("id", task.id).eq("post_state", "CANCEL_PENDING"));
    await payments().compensateHold(task, hold, "posting cancelled before publication");
  }
  // MPP listings reserve when payment is made; card/mock reserved in prepareTask.
  if (task.payment_mode !== "mpp") {
    await adjustBuyerBalance(task.buyer_id, { reserved: -task.max_price_cents }, { key: `unreserve:${task.id}` });
    if (task.job_id) await adjustJobBudget(task.job_id, { reserved: -task.max_price_cents }, { key: `unreserve:${task.id}` });
  }
  const rows = unwrap(await db().from("tasks").update({ post_state: "CANCELLED", payment_state: "RELEASED", post_hold: null, updated_at: nowIso() }).eq("id", task.id).eq("post_state", "CANCEL_PENDING").select()) as TaskRow[];
  return rows[0] ?? (await read(task.id))!;
}

export async function resumePosts(): Promise<number> {
  const cutoff = new Date(Date.now() - 120_000).toISOString();
  const rows = unwrap(await db().from("tasks").select("*").in("post_state", ["HOLDING", "CANCEL_PENDING"]).lt("updated_at", cutoff).limit(20)) as TaskRow[];
  let resumed = 0;
  for (const task of rows) {
    try {
      // Stripe may prune an idempotency key after 24h. Never replay an unknown
      // old hold outside that window: retain the reservation for reconciliation.
      if (!task.post_hold && Date.now() - Date.parse(task.created_at) > 23 * 3600_000) continue;
      const buyer = await one<AgentRow>(await db().from("agents").select("*").eq("id", task.buyer_id).limit(1));
      if (!buyer) continue;
      if (task.post_state === "CANCEL_PENDING" || Date.parse(task.expires_at) <= Date.now()) await cancelPosting(task, buyer);
      else await finishPost(task, buyer);
      resumed++;
    } catch { /* Durable state remains visible; the next sweep can resume it. */ }
  }
  return resumed;
}
