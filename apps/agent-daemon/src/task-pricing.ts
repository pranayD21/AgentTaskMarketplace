/** The server advertises this mode only when a claim accepts the task's offer. */
export function requireTaskPricing(info: unknown): void {
  if ((info as { pricing?: { mode?: unknown } })?.pricing?.mode !== "task_offer") {
    throw new Error("TASK_PRICING_UNSUPPORTED");
  }
}

export interface OfferedTask {
  task_id: string;
  price_cents: number | null;
  eligible_models: string[];
  max_runtime_s: number;
  job_id?: string | null;
  part_key?: string | null;
  attempt?: number | null;
}

/** Prefer the largest posted offer among tasks this computer can execute. */
export function selectOfferedTask(tasks: OfferedTask[], modelIds: string[], taskId?: string): (OfferedTask & { price_cents: number }) | undefined {
  let chosen: (OfferedTask & { price_cents: number }) | undefined;
  for (const task of tasks) {
    if (taskId && task.task_id !== taskId) continue;
    if (!task.eligible_models.some((model) => modelIds.includes(model))) continue;
    if (typeof task.price_cents !== "number" || !Number.isSafeInteger(task.price_cents) || task.price_cents <= 0) continue;
    // Equal offers retain server order. The advertised task price is never replaced with a seller quote.
    if (!chosen || task.price_cents > chosen.price_cents) chosen = { ...task, price_cents: task.price_cents };
  }
  return chosen;
}
