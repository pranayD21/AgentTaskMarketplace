import { expect, it, vi } from "vitest";
import { runBuyerAgent, type AgentEvent } from "../src/buyer-agent.js";
import { BenchmarkPolicy } from "../../../scripts/autonomous-benchmark/policy.js";
import { submissionTools } from "../../../scripts/autonomous-benchmark/submission.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

it("dispatches only model-requested tools and never posts from the host planner", async () => {
  const events: AgentEvent[] = [];
  const invoke = vi.fn(async () => ({ task_id: "task-model-chosen" }));
  const responses = [{ role: "assistant", content: "", tool_calls: [{ function: { name: "mcp_post_task", arguments: { prompt: "model-selected" } } }] }, { role: "assistant", content: "Done" }];
  const fetchImpl = vi.fn(async () => Response.json({ message: responses.shift(), eval_count: 3 }));
  await runBuyerAgent({ model: "fixture", ollamaUrl: "http://fixture", system: "neutral", prompt: "solve", deadline: Date.now() + 10000, signal: new AbortController().signal,
    tools: [{ name: "mcp_post_task", description: "fixture", parameters: {}, invoke }], onEvent: e => events.push(e), isComplete: () => false, fetchImpl: fetchImpl as typeof fetch });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]?.[0]).toEqual({ prompt: "model-selected" });
  expect(events.filter(e => e.type === "tool_call")).toHaveLength(1);
});

it("a hallucinated marketplace tool cannot escape the local-only tool set", async () => {
  const events: AgentEvent[] = [];
  const responses = [{ role: "assistant", content: "", tool_calls: [{ function: { name: "mcp_post_task", arguments: {} } }] }, { role: "assistant", content: "done" }];
  await runBuyerAgent({ model: "fixture", ollamaUrl: "http://fixture", system: "neutral", prompt: "solve", deadline: Date.now() + 10000, signal: new AbortController().signal,
    tools: [], onEvent: e => events.push(e), isComplete: () => false,
    fetchImpl: (async () => Response.json({ message: responses.shift() })) as typeof fetch });
  expect(events.find(e => e.type === "tool_result")?.result).toEqual({ error: "Unknown or unavailable tool" });
});

it("an aborted run cannot start another model request", async () => {
  const controller = new AbortController(); controller.abort(new Error("deadline"));
  const fetchImpl = vi.fn();
  await expect(runBuyerAgent({ model: "fixture", ollamaUrl: "http://fixture", system: "", prompt: "", tools: [], signal: controller.signal, deadline: Date.now(), onEvent: () => {}, isComplete: () => false, fetchImpl })).rejects.toThrow("deadline");
  expect(fetchImpl).not.toHaveBeenCalled();
});

const post = (prompt: string) => ({ prompt, price_cents: 100, allowed_models: ["qwen3:8b"] });
it("local code submission cannot be diverted by a hallucinated remote-result field", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atm-submit-test-"));
  try {
    const submitted = new Map();
    const tools = submissionTools({ network: false, dir, taskIds: ["HumanEval/0"], submitted, cached: new Map() });
    expect(tools.map(t => t.name)).toEqual(["submit_solution"]);
    expect(tools[0]!.parameters.properties).not.toHaveProperty("source_task_id");
    await tools[0]!.invoke({ task_ids: ["HumanEval/0"], code: "def f(): pass", source_task_id: "HumanEval/0" }, new AbortController().signal);
    expect(submitted.get("HumanEval/0").source_task_id).toBeNull();
  } finally { fs.rmSync(dir, { recursive: true }); }
});
it("remote submission requires both approval and a verified commitment", async () => {
  const cached = new Map([["remote", { task: { status: "SUBMITTED" }, result: { commitment_verified: true, answer: "def f(): pass" } }]]);
  const tools = submissionTools({ network: true, dir: os.tmpdir(), taskIds: ["HumanEval/0"], submitted: new Map(), cached });
  await expect(tools[1]!.invoke({ task_ids: ["HumanEval/0"], source_task_id: "remote" }, new AbortController().signal)).rejects.toThrow("APPROVED");
});
it("reserves the experiment ceiling synchronously and retains unknown outcomes", () => {
  const policy = new BenchmarkPolicy("test", 200);
  const first = policy.preparePost(post("one"), 400);
  expect(policy.preparePost(post("one"), 300)).toBe(first);
  policy.preparePost(post("two"), 300);
  expect(() => policy.preparePost(post("three"), 300)).toThrow("ceiling");
  expect(policy.posts).toHaveLength(2);
});
it("rejects paid-judge calls, late work, other models and conflicting prices", () => {
  const policy = new BenchmarkPolicy("test");
  expect(() => policy.preparePost({ ...post("x"), rubric: { kind: "llm_rubric" } }, 300)).toThrow("Payment acceptance");
  expect(() => policy.preparePost(post("x"), 44)).toThrow("Too little time");
  expect(() => policy.preparePost({ ...post("x"), allowed_models: ["another"] }, 300)).toThrow("qwen3");
  expect(() => policy.preparePost({ ...post("x"), max_price_cents: 50 }, 300)).toThrow("Conflicting");
  expect(policy.posts).toHaveLength(0);
});
