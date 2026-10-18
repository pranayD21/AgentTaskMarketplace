import { expect } from "vitest";
import { keypairFromSecretB64, sealJson } from "@atm/crypto";
import { createRunner, type RunnerHost } from "@atm/runner-core";
import { MarketplaceError, type KeyDescriptor } from "@atm/shared";
import { db, unwrap, type AgentRow, type SettlementRow, type TaskRow } from "../src/db.ts";
import * as svc from "../src/service.ts";

/** Stands in for Ollama: lists qwen3:8b and answers every chat with `answer`. */
export function fakeOllamaHost(answer: string): RunnerHost {
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
  return {
    fetch: (async (url: string | URL | Request) =>
      String(url).endsWith("/api/tags") ? json({ models: [{ name: "qwen3:8b", digest: "test" }] }) : json({ message: { content: answer }, eval_count: 3 })) as typeof fetch,
    getSecret: async () => undefined,
    now: () => Date.now(),
  };
}

let n = 0;
export async function agent(kind: "buyer" | "seller" | "judge", spend_cap_cents?: number): Promise<AgentRow> {
  const { agent } = await svc.registerAgent({ kind, display_name: `${kind}-${++n}`, spend_cap_cents, judge_secret: kind === "judge" ? "test-judge-secret" : undefined });
  return agent;
}

export async function seller(ask = 60): Promise<AgentRow> {
  const a = await agent("seller");
  await svc.registerSeller(a, { models: [{ model_id: "qwen3:8b", ask_cents: ask }], runtime: "wassette" });
  return a;
}

export async function post(buyer: AgentRow, extra: Partial<svc.PostTaskInput> = {}, expected = "Lima") {
  const fresh = (await svc.getAgent(buyer.id))!;
  return (await svc.postTask(fresh, { prompt: "What is the capital of Peru? One word.", allowed_models: ["qwen3:8b"], max_price_cents: 100, rubric: { kind: "contains_text", expected_text: expected }, ...extra })).task;
}

/** Seller side of one cycle, as the sandbox does it. */
export async function runCycle(s: AgentRow, taskId: string, answer = "Lima") {
  const runner = createRunner(fakeOllamaHost(answer));
  const key = runner.getPublicKey();
  const claim = await svc.claimTask(s, taskId, "qwen3:8b", { runner_pubkey_b64: key.public_key_b64, runner_key_id: key.key_id });
  const out = await runner.runTask(claim.seller_envelope, { ollama_url: "http://ollama.test", model_id: claim.model_id, buyer_public_key: claim.buyer_public_key, judge_public_key: claim.judge_public_key });
  return { claim, submitted: await svc.submitResult(s, taskId, claim.claim_id, out) };
}

export const judgeKeypair = () => keypairFromSecretB64(process.env.JUDGE_PRIVATE_KEY_B64!);

export async function expectError(p: Promise<unknown>, code: string): Promise<MarketplaceError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(MarketplaceError);
  expect((err as MarketplaceError).code).toBe(code);
  return err as MarketplaceError;
}

export async function taskRow(id: string): Promise<TaskRow> {
  return (await svc.getTask(id))!;
}

export async function settlementRow(taskId: string): Promise<SettlementRow | undefined> {
  return (unwrap(await db().from("settlements").select("*").eq("task_id", taskId).limit(1)) as SettlementRow[])[0];
}

/** Pretend a timestamp column was written long ago (resume and retry delays). */
export async function backdate(table: "tasks" | "settlements", match: { col: string; val: string }, col: string): Promise<void> {
  unwrap(await db().from(table).update({ [col]: new Date(Date.now() - 3_600_000).toISOString() }).eq(match.col, match.val));
}

/** A judge-produced replacement sealed to the buyer, the way runner-core builds it. */
export function replacementFor(buyerKey: KeyDescriptor, answer: string) {
  return sealJson(buyerKey, { answer, produced_by: "judge" });
}
