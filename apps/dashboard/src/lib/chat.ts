import type { AgentEvent, Run, TaskState } from "./api";

export const TERMINAL = new Set(["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"]);
export const ACTIVE_RUN = new Set(["running", "waiting"]);

export const TASK_LABELS: Record<string, string> = {
  OPEN: "Waiting for a worker", PAYLOAD_READY: "Worker accepted", CLAIMED: "Worker accepted", RUNNING: "Worker is working",
  SUBMITTED: "Output received · awaiting review", JUDGING: "Output received · review in progress",
  APPROVED: "Completed · approved", REJECTED: "Review rejected this output", EXPIRED: "Expired", CANCELLED: "Cancelled",
};

export const TOOL_LABELS: Record<string, string> = {
  mcp_marketplace_info: "Checking marketplace options", mcp_whoami: "Checking account limits",
  mcp_list_sellers: "Looking for available workers", mcp_create_job: "Creating a shared job",
  mcp_post_task: "Posting a task for the network", mcp_get_task: "Checking task progress",
  mcp_get_result: "Reading task results", mcp_get_job: "Checking the shared job",
  delegate_tasks: "Delegating tasks to the network", local_capacity: "Inspecting local compute", check_delegated_tasks: "Checking delegated tasks", wait_for_subagents: "Waiting for network workers", wait: "Waiting for workers",
};
export const toolLabel = (name: string | undefined) => TOOL_LABELS[name ?? ""] ?? String(name ?? "Agent action").replaceAll("_", " ");

export type ToolState = "input-streaming" | "input-available" | "output-available" | "output-error";

export type TimelineItem =
  | { kind: "assistant"; key: string; content: string; thinking?: string; streaming: boolean }
  | { kind: "tool"; key: string; name: string; args: unknown; result?: unknown; state: ToolState }
  | { kind: "task"; key: string; task: TaskState }
  | { kind: "note"; key: string; text: string; tone?: "muted" | "warning" }
  /** Where network results re-entered the conversation; task cards render here so the final answer stays last. */
  | { kind: "results"; key: string };

export interface TaskView {
  task_id: string; index: number; status: string; label: string; seller_id?: string | null; model_id?: string | null;
  prompt?: string; answer?: string; answerStatus?: string; approved: boolean;
}

/** Collapses the raw event log into renderable items. Text is never treated as HTML. */
export function timeline(run: Run): TimelineItem[] {
  const items: TimelineItem[] = [];
  const openTools = new Map<string, number>();
  run.events.forEach((event, index) => {
    const key = `${run.id}:${index}`;
    switch (event.type) {
      case "model": {
        const message = event.message ?? {};
        const content = (message.content ?? "").trim();
        // Small models often repeat their last answer verbatim after results arrive; keep only the latest copy.
        if (content) {
          const dup = items.findIndex((i) => i.kind === "assistant" && !i.streaming && i.content.trim() === content);
          if (dup >= 0) items.splice(dup, 1);
        }
        if (message.thinking || content)
          items.push({ kind: "assistant", key, content: message.content ?? "", thinking: message.thinking || undefined, streaming: false });
        break;
      }
      case "model_delta": {
        if (event.content || event.thinking)
          items.push({ kind: "assistant", key, content: event.content ?? "", thinking: event.thinking || undefined, streaming: true });
        break;
      }
      case "tool_call": {
        openTools.set(String(event.name), items.length);
        items.push({ kind: "tool", key, name: String(event.name ?? ""), args: event.arguments, state: "input-available" });
        break;
      }
      case "tool_result": {
        const at = openTools.get(String(event.name));
        const failed = typeof event.result === "object" && event.result !== null && "error" in (event.result as object);
        if (at !== undefined && items[at]?.kind === "tool") {
          const tool = items[at] as Extract<TimelineItem, { kind: "tool" }>;
          tool.result = event.result; tool.state = failed ? "output-error" : "output-available";
          openTools.delete(String(event.name));
        } else items.push({ kind: "tool", key, name: String(event.name ?? ""), args: undefined, result: event.result, state: failed ? "output-error" : "output-available" });
        break;
      }
      case "task_status": {
        if (event.task) {
          // Keep one status row per task; newer status replaces older in place.
          const existing = items.findIndex((i) => i.kind === "task" && i.task.task_id === event.task!.task_id);
          const item = { kind: "task" as const, key, task: event.task };
          if (existing >= 0) items[existing] = item; else items.push(item);
        }
        break;
      }
      case "remote_answer": case "remote_preview": break; // shown on task cards
      case "resumed": if (!items.some((i) => i.kind === "results")) items.push({ kind: "results", key }); break;
      case "stopped":
        if (event.reason !== "model_finished")
          items.push({ kind: "note", key, text: `Agent stopped: ${String(event.reason ?? run.status).replaceAll("_", " ")}`, tone: "warning" });
        break;
      default: break;
    }
  });
  return items;
}

export function tasks(run: Run): TaskView[] {
  return (run.task_ids ?? []).map((task_id, index) => {
    const state = run.events.filter((e) => e.type === "task_status" && e.task?.task_id === task_id).at(-1)?.task;
    const answer = run.events.filter((e) => ["remote_answer", "remote_preview"].includes(e.type) && e.task_id === task_id).at(-1);
    const status = state?.status ?? "OPEN";
    return {
      task_id, index, status, label: TASK_LABELS[status] ?? status, seller_id: state?.seller_id, model_id: state?.model_id,
      prompt: run.task_prompts?.[task_id], answer: answer?.answer, answerStatus: answer?.status, approved: status === "APPROVED",
    };
  });
}

export function runHeadline(run: Run) {
  switch (run.status) {
    case "finished": return { text: "Completed", tone: "success" as const };
    case "failed": return { text: "Needs attention", tone: "danger" as const };
    case "waiting": return { text: "Waiting for network workers", tone: "info" as const };
    case "running": return { text: "Working", tone: "info" as const };
    case "stopped": case "interrupted": return { text: "Stopped", tone: "muted" as const };
    default: return { text: run.status, tone: "muted" as const };
  }
}

export const conversationOf = (run: Run) => run.conversation_id || run.id;
export const lastAssistantText = (run: Run) =>
  run.events.filter((e) => e.type === "model" && typeof e.message?.content === "string" && e.message.content).at(-1)?.message?.content ?? "";
