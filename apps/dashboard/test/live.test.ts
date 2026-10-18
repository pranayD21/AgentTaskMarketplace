import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { apply, createModel, describe as headline, type LiveModel } from "../src/lib/live";
import { LiveWorkspace } from "../src/components/live-workspace";

const feed = (m: LiveModel, events: Record<string, unknown>[]) => { let at = 1_000; for (const e of events) apply(m, { at: (at += 100), ...e } as never); };

const boot = [
  { t: "hello", role: "seller", runtime: "wassette", tap: true },
  { t: "vm", vm: "vm-1", role: "seller", runtime: "wassette", network: ["http://127.0.0.1:1"], env: [], state: "booting" },
  { t: "vm", vm: "vm-1", pid: 42, state: "ready" },
];
const cycle = (task: string, ok: boolean) => [
  { t: "step", vm: "vm-1", name: "run-cycle-measured", phase: "start", args: { task_id: task } },
  { t: "net", phase: "start", id: `${task}-claim`, vm: "vm-1", target: "marketplace", call: "claim_task", req: { task_id: task } },
  { t: "net", phase: "end", id: `${task}-claim`, vm: "vm-1", status: 200, ms: 30, ok: true, res: { claim: { task_id: task, claim_id: "c" } } },
  { t: "net", phase: "start", id: `${task}-chat`, vm: "vm-1", target: "ollama", call: "/api/chat", req: { model: "qwen3:8b", messages: [{ role: "user", content: `do ${task}` }] } },
  { t: "token", id: `${task}-chat`, vm: "vm-1", text: "hello ", thinking: "hmm " },
  ...(ok
    ? [{ t: "net", phase: "end", id: `${task}-chat`, vm: "vm-1", status: 200, ms: 500, ok: true, res: { content: "hello world", eval_count: 2 } },
      { t: "step", vm: "vm-1", name: "run-cycle-measured", phase: "end", ok: true, ms: 900, result: { result: { task_id: task, result_id: "r1" } } }]
    : [{ t: "net", phase: "end", id: `${task}-chat`, vm: "vm-1", status: 500, ms: 500, ok: false, error: "OLLAMA_HTTP_500" },
      { t: "step", vm: "vm-1", name: "run-cycle-measured", phase: "end", ok: false, ms: 900, error: "OLLAMA_HTTP_500" }]),
];

describe("live view reducer", () => {
  it("follows the streaming answer of the current task", () => {
    const m = createModel();
    feed(m, [...boot, ...cycle("task_a", true).slice(0, 5)]);
    expect(m.run?.taskId).toBe("task_a");
    expect(m.run?.stages.claim.state).toBe("done");
    expect(m.run?.stages.infer.state).toBe("active");
    expect(m.run?.output).toBe("hello ");
    expect(m.run?.thinking).toBe("hmm ");
    expect(m.run?.prompt?.[0]?.content).toBe("do task_a");
    expect(headline(m, true).label).toBe("Writing the answer…");
    feed(m, [{ t: "token", id: "task_a-chat", vm: "vm-1", text: "**bold**" }]);
    expect(renderToStaticMarkup(createElement(LiveWorkspace, { model: m, connection: "open", running: true }))).toContain("<strong>bold</strong>");
  });

  it("moves on to the next task after one fails, keeping no history", () => {
    const m = createModel();
    feed(m, [...boot, ...cycle("task_a", false)]);
    expect(m.run?.status).toBe("failed");
    expect(m.run?.error).toBe("OLLAMA_HTTP_500");
    expect(headline(m, true).label).toContain("Task failed");
    feed(m, cycle("task_b", true));
    expect(m.run?.taskId).toBe("task_b");
    expect(m.run?.status).toBe("done");
    expect(m.run?.output).toBe("hello ");
    expect(m.runs).toBe(2);
    expect(headline(m, true).label).toBe("Output submitted · awaiting review");
  });

  it("shows a lost claim race as normal contention without an error", () => {
    const m = createModel();
    feed(m, [...boot,
      { t: "step", vm: "vm-1", name: "run-cycle-measured", phase: "start", args: { task_id: "task_a" } },
      { t: "net", phase: "start", id: "claim-a", vm: "vm-1", target: "marketplace", call: "claim_task", req: { task_id: "task_a" } },
      { t: "net", phase: "end", id: "claim-a", vm: "vm-1", status: 409, ok: false, error: "CLAIM_CONFLICT", res: { code: "CLAIM_CONFLICT" } },
      { t: "step", vm: "vm-1", name: "run-cycle-measured", phase: "end", ok: false, error: "CLAIM_CONFLICT" },
    ]);
    expect(m.run?.status).toBe("missed");
    expect(m.run?.stages.claim.state).toBe("skipped");
    expect(m.run?.nets[0]).toMatchObject({ missed: true, res: { message: "Another agent took the task before you." } });
    expect(headline(m, true)).toMatchObject({ label: "Another agent took the task before you.", tone: "muted" });
    expect(JSON.stringify(m.log)).not.toContain("CLAIM_CONFLICT");
    const html = renderToStaticMarkup(createElement(LiveWorkspace, { model: m, connection: "open", running: true }));
    expect(html).toContain("Another agent took the task before you.");
    expect(html).not.toContain("CLAIM_CONFLICT");
    expect(html).not.toContain("Task failed");
    expect(html).not.toContain("text-danger");
    feed(m, [{ t: "vm", vm: "vm-1", state: "crashed", reason: "CLAIM_CONFLICT" }]);
    expect(m.run?.status).toBe("missed");
    expect(renderToStaticMarkup(createElement(LiveWorkspace, { model: m, connection: "open", running: true }))).not.toContain("text-danger");
  });

  it("marks the run failed when the sandbox crashes, then waits again", () => {
    const m = createModel();
    feed(m, [...boot, ...cycle("task_a", true).slice(0, 5), { t: "vm", vm: "vm-1", state: "crashed", reason: "SANDBOX_EXITED" }]);
    expect(m.run?.status).toBe("failed");
    expect(m.run?.error).toBe("SANDBOX_EXITED");
    feed(m, [{ t: "vm", vm: "vm-2", role: "seller", runtime: "wassette", state: "booting" }, { t: "vm", vm: "vm-2", state: "ready" }]);
    expect(m.vm?.id).toBe("vm-2");
    expect(m.run).toBeUndefined();
    expect(headline(m, true).label).toBe("Waiting for an eligible task…");
  });

  it("drops idle judge polls instead of counting them as runs", () => {
    const m = createModel();
    feed(m, [...boot, { t: "step", vm: "vm-1", name: "judge-cycle", phase: "start" }, { t: "step", vm: "vm-1", name: "judge-cycle", phase: "end", ok: true, result: { idle: true } }]);
    expect(m.run).toBeUndefined();
    expect(m.runs).toBe(0);
  });
});
