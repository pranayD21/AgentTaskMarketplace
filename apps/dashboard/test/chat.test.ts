import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { tasks, timeline, runHeadline } from "../src/lib/chat";
import type { Run } from "../src/lib/api";
import { TaskCard } from "../src/components/task-card";
import { ToolInvocation, ToolInvocationContentCollapsible, ToolInvocationName, ToolInvocationRawData } from "../src/components/ui/tool-invocation";
import { Markdown } from "../src/components/markdown";

const at = "2026-10-18T02:00:00.000Z";
const run: Run = {
  id: "run1", prompt: "Compare regions", model: "qwen3:8b", status: "waiting", conversation_id: "c1", task_ids: ["task_a"],
  task_prompts: { task_a: "List instance families in us-east-1" },
  events: [
    { type: "model_delta", at, turn: 0, content: "I will split", thinking: "" },
    { type: "model", at, turn: 0, message: { role: "assistant", content: "I will split the work.", thinking: "Independent parts.", tool_calls: [] } },
    { type: "tool_call", at, turn: 1, name: "mcp_list_sellers", arguments: { model_id: "qwen3:8b" } },
    { type: "tool_result", at, turn: 1, name: "mcp_list_sellers", result: { sellers: [] } },
    { type: "tool_call", at, turn: 2, name: "mcp_post_task", arguments: { prompt: "x" } },
    { type: "tool_result", at, turn: 2, name: "mcp_post_task", result: { error: "Conversation delegation limit reached" } },
    { type: "task_status", at, task: { task_id: "task_a", status: "OPEN" } },
    { type: "task_status", at, task: { task_id: "task_a", status: "SUBMITTED", seller_id: "seller_1", model_id: "qwen3:8b" } },
    { type: "remote_preview", at, task_id: "task_a", status: "SUBMITTED", answer: "draft output" },
    { type: "tool_call", at, turn: 3, name: "wait_for_subagents", arguments: {} },
  ],
};
type Item = ReturnType<typeof timeline>[number];

describe("chat timeline", () => {
  it("pairs tool calls with results, keeps one status row per task, and drops streaming deltas", () => {
    const items = timeline(run);
    expect(items.map((i) => i.kind)).toEqual(["assistant", "assistant", "tool", "tool", "task", "tool"]);
    const tools = items.filter((i) => i.kind === "tool") as Extract<Item, { kind: "tool" }>[];
    expect(tools[0]!.state).toBe("output-available");
    expect(tools[1]!.state).toBe("output-error");
    expect(tools[2]!.state).toBe("input-available");
    const task = items.find((i) => i.kind === "task") as Extract<Item, { kind: "task" }>;
    expect(task.task.status).toBe("SUBMITTED");
  });
  it("builds task cards that never promote a submitted preview to an approved result", () => {
    const [card] = tasks(run);
    expect(card!.approved).toBe(false);
    expect(card!.answer).toBe("draft output");
    const html = renderToStaticMarkup(createElement(TaskCard, { task: card!, defaultOpen: true }));
    expect(html).toContain("Submitted output");
    expect(html).toContain("not an approved result");
    expect(html).not.toContain("Final output");
    expect(html).toContain("List instance families");
    expect(renderToStaticMarkup(createElement(TaskCard, { task: card! }))).not.toContain("draft output");
    expect(html).toContain("/task.html?task=task_a");
    const approved = tasks({ ...run, events: [...run.events, { type: "task_status", at, task: { task_id: "task_a", status: "APPROVED" } }, { type: "remote_answer", at, task_id: "task_a", status: "APPROVED", answer: "final" }] })[0]!;
    expect(approved.approved).toBe(true);
    expect(renderToStaticMarkup(createElement(TaskCard, { task: approved, defaultOpen: true }))).toContain("does not verify answer correctness");
  });
  it("keeps only the latest copy of an answer the model repeated after results arrived", () => {
    const repeated: Run = { ...run, status: "finished", events: [
      { type: "model", at, turn: 0, message: { role: "assistant", content: "Final answer." } },
      { type: "resumed", at, tasks: ["task_a"] },
      { type: "model", at, turn: 1, message: { role: "assistant", content: "Final answer." } },
    ] };
    const items = timeline(repeated);
    expect(items.map((i) => i.kind)).toEqual(["results", "assistant"]);
  });
  it("renders Markdown with inline and block LaTeX as MathML, never as raw HTML", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: "Area is $\\pi r^2$.\n\n$$E = mc^2$$\n\n<script>x</script> **bold**" }));
    expect(html).toContain("<math");
    expect(html).toContain('display="block"');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<script>");
  });
  it("escapes untrusted text in tool data and labels run states", () => {
    const html = renderToStaticMarkup(createElement(ToolInvocation, null,
      createElement(ToolInvocationContentCollapsible, { defaultOpen: true, header: createElement(ToolInvocationName, { name: "mcp_post_task", type: "output-error" }) },
        createElement(ToolInvocationRawData, { data: { prompt: "<script>alert(1)</script>" }, title: "Arguments" }))));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Error");
    expect(runHeadline(run).text).toBe("Waiting for network workers");
    expect(runHeadline({ ...run, status: "failed" }).tone).toBe("danger");
  });
});
