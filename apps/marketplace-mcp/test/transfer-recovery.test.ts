import { afterEach, describe, expect, it, vi } from "vitest";
import { db, unwrap } from "../src/db.ts";
import { payments, type TransferOutcome } from "../src/payments.ts";
import { retryPendingTransfers } from "../src/settlement.ts";
import * as svc from "../src/service.ts";
import { agent, backdate, post, runCycle, seller, settlementRow } from "./helpers.ts";

afterEach(async () => { vi.restoreAllMocks(); unwrap(await db().from("settlements").update({ transfer_state: "NOT_APPLICABLE" }).eq("transfer_state", "PENDING")); });
async function fixture() {
  const b = await agent("buyer"), s = await seller(), j = await agent("judge");
  const task = await post(b), { submitted } = await runCycle(s, task.task_id);
  await svc.submitVerdict(j, { task_id: task.task_id, result_id: submitted.result_id, verdict: "APPROVE", reason_code: "RUBRIC_MATCH" });
  unwrap(await db().from("settlements").update({ transfer_state: "PENDING", payout_transferred_cents: 0, stripe_transfer_id: null }).eq("task_id", task.task_id));
  return task.task_id;
}
const paid: TransferOutcome = { transfer_id: "tr_recovered", state: "TRANSFERRED", amount_cents: 100, note: "recovered" };
const unknown: TransferOutcome = { transfer_id: null, state: "PENDING", amount_cents: 0, pending_reason: "PROVIDER_ERROR", note: "timeout" };

describe("durable payout ownership", () => {
  it("two concurrent sweeps start one provider call", async () => {
    const id = await fixture();
    let done!: (v: TransferOutcome) => void, entered!: () => void;
    const started = new Promise<void>((r) => entered = r);
    const request = new Promise<TransferOutcome>((r) => done = r);
    const retry = vi.spyOn(payments(), "retryTransfer").mockImplementation(async () => { entered(); return request; });
    const first = retryPendingTransfers(); await started;
    expect((await retryPendingTransfers()).attempted).toBe(0);
    expect(retry).toHaveBeenCalledTimes(1);
    done(paid); await first;
    expect(await settlementRow(id)).toMatchObject({ transfer_state: "TRANSFERRED", payout_transferred_cents: 100 });
  });
  it("an expired lease reuses the in-flight key and a stale worker cannot overwrite the winner", async () => {
    const id = await fixture();
    let done!: (v: TransferOutcome) => void, entered!: () => void;
    const started = new Promise<void>((r) => entered = r);
    const request = new Promise<TransferOutcome>((r) => done = r);
    const retry = vi.spyOn(payments(), "retryTransfer").mockImplementationOnce(async () => { entered(); return request; }).mockResolvedValueOnce(paid);
    const first = retryPendingTransfers(); await started;
    await backdate("settlements", { col: "task_id", val: id }, "transfer_lease_until");
    expect((await retryPendingTransfers()).transferred).toBe(1);
    done(unknown); await first;
    expect(retry.mock.calls.map((c) => c[3]?.attempt)).toEqual([0, 0]);
    expect(await settlementRow(id)).toMatchObject({ transfer_state: "TRANSFERRED", stripe_transfer_id: "tr_recovered", payout_transferred_cents: 100 });
  });
  it("unknown failures reuse a key, while only a definitive failure advances it", async () => {
    const id = await fixture();
    const retry = vi.spyOn(payments(), "retryTransfer").mockResolvedValueOnce(unknown).mockResolvedValueOnce({ ...unknown, retry_safe_to_advance: true } as TransferOutcome).mockResolvedValueOnce(paid);
    await retryPendingTransfers();
    await backdate("settlements", { col: "task_id", val: id }, "transfer_retry_at"); await retryPendingTransfers();
    await backdate("settlements", { col: "task_id", val: id }, "transfer_retry_at"); await retryPendingTransfers();
    expect(retry.mock.calls.map((c) => c[3]?.attempt)).toEqual([0, 0, 1]);
  });
  it("a mismatched transfer is never marked paid or retried automatically", async () => {
    const id = await fixture();
    const retry = vi.spyOn(payments(), "retryTransfer").mockResolvedValue({ ...unknown, pending_reason: "MISMATCH" });
    await retryPendingTransfers(); await retryPendingTransfers();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(await settlementRow(id)).toMatchObject({ transfer_state: "PENDING", transfer_manual_review: true, transfer_pending_reason: "MISMATCH", payout_transferred_cents: 0 });
  });
  it("requires reconciliation when an uncertain key is too old for safe replay", async () => {
    const id = await fixture();
    unwrap(await db().from("settlements").update({ transfer_key_created_at: new Date(Date.now() - 25 * 3600_000).toISOString() }).eq("task_id", id));
    const retry = vi.spyOn(payments(), "retryTransfer");
    await retryPendingTransfers();
    expect(retry).not.toHaveBeenCalled();
    expect(await settlementRow(id)).toMatchObject({ transfer_manual_review: true, transfer_pending_reason: "IDEMPOTENCY_WINDOW" });
  });
});
