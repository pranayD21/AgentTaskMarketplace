import { parseAction } from '../src/buyer-agent.js';
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

it('stops repeated failing tool calls instead of looping for the whole deadline',async()=>{
 const fetchImpl=vi.fn(async()=>Response.json({message:{role:'assistant',content:'',tool_calls:[{function:{name:'missing',arguments:{}}}]}}));
 await expect(runBuyerAgent({model:'fixture',ollamaUrl:'http://fixture',system:'',prompt:'',tools:[],signal:new AbortController().signal,deadline:Date.now()+600000,onEvent:()=>{},isComplete:()=>false,fetchImpl:fetchImpl as typeof fetch})).rejects.toThrow('Repeated tool errors');
 expect(fetchImpl).toHaveBeenCalledTimes(6);
});
it('repairs malformed actions, invokes a real tool adapter, then returns the explicit final answer',async()=>{
 const invoke=vi.fn(async()=>({task_id:'task_observed'}));const events:AgentEvent[]=[];
 const replies=['not json',JSON.stringify({action:'tool',tool:'delegate',arguments:{prompt:'Specific work'}}),JSON.stringify({action:'final',answer:'Completed using task_observed'})];
 await runBuyerAgent({model:'plain-model',ollamaUrl:'http://fixture',system:'',prompt:'Help',tools:[{name:'delegate',description:'Delegate',parameters:{type:'object',properties:{prompt:{type:'string'}},required:['prompt']},invoke}],structuredActions:true,signal:new AbortController().signal,deadline:Date.now()+10000,isComplete:()=>false,onEvent:e=>events.push(e),fetchImpl:async(_url,init)=>{const body=JSON.parse(String(init?.body));expect(body.tools).toBeUndefined();expect(body.think).toBeUndefined();return Response.json({message:{role:'assistant',content:replies.shift()}});}});
 expect(invoke).toHaveBeenCalledExactlyOnceWith({prompt:'Specific work'},expect.any(AbortSignal));expect(events.some(e=>e.type==='action_error')).toBe(true);expect(events.filter(e=>e.type==='model').at(-1)?.message).toMatchObject({content:'Completed using task_observed'});
});

it('salvages fenced or prose-wrapped actions and rejects anything else',()=>{
 expect(parseAction('```json\n{"action":"final","answer":"42"}\n```')).toEqual({action:'final',answer:'42'});
 expect(parseAction('Sure. {"action":"tool","tool":"delegate_tasks","arguments":{"tasks":[]}} done')).toEqual({action:'tool',tool:'delegate_tasks',arguments:{tasks:[]}});
 expect(parseAction('I will wait for the workers.')).toBeNull();
 expect(parseAction('{"action":"nope"}')).toBeNull();
});

it('asks for an action after an empty turn with nothing pending, but idles when work is outstanding',async()=>{
 const events:AgentEvent[]=[];const bodies:any[]=[];let pending=false;
 const replies=[{content:'',thinking:'planning'},{content:JSON.stringify({action:'tool',tool:'go',arguments:{}})},{content:'',thinking:'waiting'},{content:JSON.stringify({action:'final',answer:'done'})}];
 const fetchImpl=vi.fn(async(_u:string,init:any)=>{bodies.push(JSON.parse(init.body));return Response.json({message:{role:'assistant',...replies.shift()}});}) as any;
 await runBuyerAgent({model:'m',ollamaUrl:'http://fixture',system:'',prompt:'Go',tools:[{name:'go',description:'',parameters:{type:'object',properties:{}},invoke:async()=>{pending=true;return {ok:true};}}],
  signal:new AbortController().signal,deadline:Date.now()+60000,onEvent:e=>events.push(e),isComplete:()=>false,structuredActions:true,fetchImpl,hasPendingWork:()=>pending,
  onIdle:async()=>{if(!pending)return null;pending=false;return [{role:'user',content:'results'}];}});
 expect(events.filter(e=>e.type==='action_error')).toHaveLength(1);
 expect(events.filter(e=>e.type==='idle_turn')).toHaveLength(1);
 expect(bodies[1].messages.at(-1).content).toContain('returned no action');
 expect(events.filter(e=>e.type==='model').at(-1)?.message.content).toBe('done');
});
