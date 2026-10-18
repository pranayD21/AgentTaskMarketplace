import { afterEach, describe, expect, it, vi } from "vitest";
import { db, unwrap } from "../src/db.ts";
import { memoryDb } from "../src/memdb.ts";
import { payments } from "../src/payments.ts";
import { resumePosts } from "../src/posting.ts";
import * as svc from "../src/service.ts";
import { agent, backdate, expectError, post, taskRow } from "./helpers.ts";

afterEach(() => { memoryDb().clearFaults(); vi.restoreAllMocks(); });
const pending = (buyer: string) => memoryDb().rows("tasks").find((r) => r.buyer_id === buyer)!;

describe("durable posting and budget transaction", () => {
  it("rolls the task and both budget reservations back when a budget write fails", async () => {
    const b = await agent("buyer");
    const { job } = await svc.createJob(b, { budget_cents: 200 });
    const hold = vi.spyOn(payments(), "hold");
    memoryDb().injectFault("jobs", "update");
    await expectError(post(b, { job_id: job.job_id, part_key: "one" }), "INTERNAL_ERROR");
    expect(hold).not.toHaveBeenCalled();
    expect(pending(b.id)).toBeUndefined();
    expect(await svc.getAgent(b.id)).toMatchObject({ reserved_cents: 0 });
    expect((await svc.getJobForBuyer(b, job.job_id)).job.reserved_cents).toBe(0);
  });
  it("recovers a committed preparation whose database response was lost, without another reservation", async () => {
    const b = await agent("buyer");
    const original = memoryDb().prepareTask.bind(memoryDb());
    vi.spyOn(memoryDb(), "prepareTask").mockImplementationOnce((row) => {
      original(row);
      return { data: null, error: { code: "NETWORK", message: "response lost after commit" } };
    });
    const first = await post(b, { client_request_id: "lost-prepare-001" });
    expect(first).toMatchObject({ status: "AWAITING_PAYMENT", payment: { state: "POSTING" } });
    expect(await svc.getAgent(b.id)).toMatchObject({ reserved_cents: 100 });
    await backdate("tasks", { col: "id", val: first.task_id }, "updated_at");
    await resumePosts();
    const again = await post(b, { client_request_id: "lost-prepare-001" });
    expect(again.task_id).toBe(first.task_id);
    expect(again.status).toBe("OPEN");
    expect(await svc.getAgent(b.id)).toMatchObject({ reserved_cents: 100 });
  });
  it("keeps an uncertain hold tracked and recovers the same post", async () => {
    const b = await agent("buyer");
    const provider = payments();
    const original = provider.hold.bind(provider);
    let held: Awaited<ReturnType<typeof original>>;
    vi.spyOn(provider, "hold").mockImplementationOnce(async (task, buyer) => { held = await original(task, buyer); throw new Error("response lost"); }).mockImplementationOnce(async () => held);
    await expectError(post(b, { client_request_id: "lost-hold-001" }), "PAYMENT_FAILED");
    const id = pending(b.id).id as string;
    expect(await taskRow(id)).toMatchObject({ post_state: "HOLDING", status: "AWAITING_PAYMENT" });
    expect(await svc.getAgent(b.id)).toMatchObject({ reserved_cents: 100 });
    await backdate("tasks", { col: "id", val: id }, "updated_at");
    await resumePosts();
    expect(await taskRow(id)).toMatchObject({ post_state: "READY", status: "OPEN" });
    expect((await post(b, { client_request_id: "lost-hold-001" })).task_id).toBe(id);
  });
  it("a failed compensation stays durable until release and both budgets are reconciled", async () => {
    const b = await agent("buyer");
    const { job } = await svc.createJob(b, { budget_cents: 100 });
    const provider = payments(), original = provider.hold.bind(provider);
    let held: Awaited<ReturnType<typeof original>>;
    vi.spyOn(provider, "hold").mockImplementationOnce(async (task, buyer) => {
      held = await original(task, buyer); memoryDb().injectFault("tasks", "update"); return held;
    }).mockImplementation(async () => held);
    await expectError(post(b, { job_id: job.job_id, part_key: "one" }), "INTERNAL_ERROR");
    const id = pending(b.id).id as string;
    vi.spyOn(provider, "compensateHold").mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(svc.cancelTask(b, id)).rejects.toThrow();
    expect(await taskRow(id)).toMatchObject({ status: "CANCELLED", post_state: "CANCEL_PENDING" });
    expect(await svc.getAgent(b.id)).toMatchObject({ reserved_cents: 100 });
    await backdate("tasks", { col: "id", val: id }, "updated_at");
    await resumePosts();
    expect(await taskRow(id)).toMatchObject({ post_state: "CANCELLED", payment_state: "RELEASED" });
    expect(await svc.getAgent(b.id)).toMatchObject({ reserved_cents: 0, spent_cents: 0 });
    expect((await svc.getJobForBuyer(b, job.job_id)).job.reserved_cents).toBe(0);
  });
  it("a slow hold response cannot reopen a cancelled post", async () => {
    const b = await agent("buyer"), provider = payments(), original = provider.hold.bind(provider);
    let unblock!: () => void, started!: () => void;
    const waiting = new Promise<void>((r) => { unblock = r; });
    const ready = new Promise<void>((r) => { started = r; });
    let held: Awaited<ReturnType<typeof original>>;
    vi.spyOn(provider, "hold").mockImplementationOnce(async (task, buyer) => { held = await original(task, buyer); started(); await waiting; return held; }).mockImplementation(async () => held);
    const posting = post(b);
    await ready;
    const id = pending(b.id).id as string;
    await svc.cancelTask(b, id);
    unblock();
    expect((await posting).status).toBe("CANCELLED");
    expect(await taskRow(id)).toMatchObject({ status: "CANCELLED", post_state: "CANCELLED" });
    expect(await svc.getAgent(b.id)).toMatchObject({ reserved_cents: 0 });
  });
});
