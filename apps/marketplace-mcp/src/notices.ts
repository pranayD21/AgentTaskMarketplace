/**
 * Task notices through Inkbox with persisted thread state (contract §12, I1).
 * inkbox.ts (E) sends; this wrapper hands it the stored thread owner and
 * contexts and stores what comes back, so a server restart between claim and
 * verdict keeps both threads. A notice never fails the tool that sent it.
 */
import { db, unwrap, type TaskRow } from "./db.js";
import { inkbox } from "./inkbox.js";

type NotifyEvent = Parameters<typeof inkbox.notify>[0];
/** inkbox.notify returns the main thread's context id today; a richer object is accepted too. */
type NotifyResult = string | null | { context_id?: string | null; buyer_context_id?: string | null; thread_owner?: string | null };

export async function notifyTask(task: TaskRow, ev: { type: string; to_handle: string | null; text: string }): Promise<void> {
  try {
    // The first recipient (the seller at assignment) owns the task's main thread.
    const owner = task.inkbox_thread_owner ?? (ev.type === "assignment" ? ev.to_handle : null);
    const event = {
      type: ev.type,
      task_id: task.id,
      to_handle: ev.to_handle,
      text: ev.text,
      context_id: task.inkbox_context_id,
      thread_owner: owner,
      buyer_context_id: task.inkbox_buyer_context_id ?? null,
    } as NotifyEvent;
    const out = (await inkbox.notify(event)) as NotifyResult;
    const next = typeof out === "string" || out === null ? { context_id: out } : out;
    const patch: Record<string, string> = {};
    if (next.context_id && next.context_id !== task.inkbox_context_id) patch.inkbox_context_id = next.context_id;
    if (next.buyer_context_id && next.buyer_context_id !== task.inkbox_buyer_context_id) patch.inkbox_buyer_context_id = next.buyer_context_id;
    const thread = next.thread_owner ?? owner;
    if (thread && thread !== task.inkbox_thread_owner) patch.inkbox_thread_owner = thread;
    if (Object.keys(patch).length) unwrap(await db().from("tasks").update(patch).eq("id", task.id));
  } catch (err) {
    console.warn(`[inkbox] ${ev.type} notice for ${task.id}: ${(err as Error).message.slice(0, 160)}`);
  }
}
