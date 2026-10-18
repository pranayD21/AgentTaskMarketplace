/**
 * Runner core: everything that must execute INSIDE the sandbox.
 *
 * Pure, host-agnostic logic shared by the Wasm component (componentize-js)
 * and the labelled Node fallback. It touches the outside world only through
 * the injected `fetch` and `getSecret`, so the sandbox policy decides what
 * it can reach.
 */
import { commitment, fromUtf8, generateKeypair, keyIdFor, open, randomB64, seal, toB64, type Keypair } from "@atm/crypto";
import {
  JudgeTaskOutput,
  ResultPlaintext,
  RunTaskOutput,
  SellerPayload,
  type Envelope,
  type KeyDescriptor,
} from "@atm/shared";
import { workerTools, invokeWorkerTool } from "./worker-agent.js";
import { withDeadline } from "./deadline.js";
import { ollamaUsage, type SellerUsage } from "./seller-measurements.js";
export { measuredCycle, modelCanary, safeSellerUsage, type SellerUsage, type MeasuredCycleOutput, type CanaryOpts, type CanaryOutput } from "./seller-measurements.js";
export type SellerRunOutput = RunTaskOutput & { seller_usage?: SellerUsage };

export { FetchMarketplace, safeFailureCode } from "./marketplace.js";
export { runCycle, type RunCycleOpts, type RunCycleOutput, type SellerRegistration } from "./seller-cycle.js";
export { judgeCycle, type JudgeCycleOpts, type JudgeCycleOutput } from "./judge-cycle.js";
export { judge, JudgeInfraError, PUBLIC_REASON, type JudgeOutcome, type JudgeTaskOpts, type JudgeUsage, type ReplacementStatus } from "./judge.js";
import { judge, type JudgeTaskOpts } from "./judge.js";

export interface RunnerHost {
  fetch: typeof fetch;
  /** Secret lookup (wasi:config/store inside Wassette, process.env in Node). */
  getSecret(name: string): Promise<string | undefined>;
  now(): number;
  onSellerUsage?(usage: SellerUsage): void;
}

export interface RunTaskOpts {
  ollama_url: string; // e.g. http://localhost:11434
  model_id: string;
  buyer_public_key: KeyDescriptor;
  judge_public_key: KeyDescriptor;
  timeout_ms?: number;
  cpu_threads?: number;
  context_tokens?: number;
  agent_mode?: boolean;
  expected_task_id?: string;
  expected_claim_id?: string;
}


export interface Runner {
  getPublicKey(): KeyDescriptor;
  runTask(sellerEnvelope: Envelope, opts: RunTaskOpts): Promise<SellerRunOutput>;
  judgeTask(taskEnvelope: Envelope, resultEnvelope: Envelope, opts: JudgeTaskOpts, judgeKey: Keypair): Promise<JudgeTaskOutput>;
}


export function createRunner(host: RunnerHost, existing?: Keypair): Runner {
  // Lazily generated so a build-time snapshot (Wizer) never bakes a key in.
  let kp: Keypair | undefined = existing;
  const keypair = (): Keypair => (kp ??= generateKeypair());

  return {
    getPublicKey() {
      const k = keypair();
      return { key_id: `runner-${keyIdFor(k.publicKey)}`, public_key_b64: toB64(k.publicKey) };
    },

    async runTask(sellerEnvelope, opts) {
      const started = host.now();
      const payload = SellerPayload.parse(JSON.parse(fromUtf8(open(keypair(), sellerEnvelope))));
      if ((opts.expected_task_id && opts.expected_task_id !== payload.task_id) ||
          (opts.expected_claim_id && opts.expected_claim_id !== payload.claim_id)) throw new Error("PAYLOAD_CLAIM_MISMATCH");
      const answer = await ollamaChat(host, opts, payload);
      host.onSellerUsage?.(answer.usage);
      const result: ResultPlaintext = {
        answer: answer.text,
        task_id: payload.task_id,
        claim_id: payload.claim_id,
        model_id: opts.model_id,
        salt_b64: randomB64(32),
      };
      const c = commitment(result);
      return { ...RunTaskOutput.parse({
        result_enc_buyer: seal(opts.buyer_public_key, c.bytes),
        result_enc_judge: seal(opts.judge_public_key, c.bytes),
        commitment_sha256: c.sha256_hex,
        runtime_ms: Math.max(0, Math.round(host.now() - started)),
        model_id: opts.model_id,
        tokens_out: answer.tokens_out,
      }), seller_usage: answer.usage };
    },

    async judgeTask(taskEnvelope, resultEnvelope, opts, judgeKey) {
      const outcome = await judge(host, taskEnvelope, resultEnvelope, opts, judgeKey);
      // Infrastructure failures are not verdicts; callers that only want a verdict see a coded error.
      if (outcome.kind === "deferred") throw new Error(outcome.failure_code);
      return outcome.output;
    },
  };
}

// ---------------------------------------------------------------------------
// Ollama (seller side)
// ---------------------------------------------------------------------------

async function ollamaChat(host: RunnerHost, opts: RunTaskOpts, payload: SellerPayload): Promise<{ text: string; tokens_out?: number; usage: SellerUsage }> {
  const messages: any[] = [
    { role: "system", content: "You are a worker model executing a task for another agent. Reason carefully, use available tools when useful, then return the requested deliverable. Tools are limited to calculation, text inspection and a task-local scratchpad. Do not claim file execution or internet access. Follow the instruction precisely." },
    { role: "user", content: payload.context ? `${payload.prompt}\n\n--- context ---\n${payload.context}` : payload.prompt },
  ];
  const started = host.now();
  const timeout = opts.timeout_ms ?? 180_000;
  return withDeadline(async (signal) => {
    const inventory = await host.fetch(`${opts.ollama_url.replace(/\/$/, "")}/api/tags`, { signal, redirect: "error" });
    if (!inventory.ok) throw new Error(`OLLAMA_HTTP_${inventory.status}`);
    const installed = await inventory.json() as { models?: { name: string }[] };
    if (signal.aborted || host.now() - started >= timeout) throw new Error("TASK_TIMEOUT");
    if (!installed.models?.some((m) => m.name === opts.model_id)) throw new Error("MODEL_NOT_INSTALLED");
    let capabilities:string[]=/^qwen3([:-]|$)/.test(opts.model_id)?['tools','thinking']:[];
    if(opts.agent_mode!==false){
      const metadata=await host.fetch(`${opts.ollama_url.replace(/\/$/, "")}/api/show`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:opts.model_id}),signal,redirect:'error'});
      if(metadata.ok){const info=await metadata.json() as any;if(Array.isArray(info.capabilities))capabilities=info.capabilities;}
    }
    const notes=new Map<string,string>();let totalTokens=0;const totalBudget=payload.max_tokens;
    const totals:Record<string,number>={};
    for(let turn=0;turn<8;turn++){
      const res = await host.fetch(`${opts.ollama_url.replace(/\/$/, "")}/api/chat`, {
        method:"POST",redirect:"error",headers:{"content-type":"application/json"},signal,
        body:JSON.stringify({model:opts.model_id,messages,tools:opts.agent_mode!==false&&capabilities.includes('tools')&&turn<7?workerTools:[],stream:false,
          think:opts.agent_mode!==false&&capabilities.includes('thinking'),options:{num_predict:Math.max(1,totalBudget-totalTokens),temperature:0.2,
          num_thread:opts.cpu_threads??4,num_ctx:opts.context_tokens??8192}}),
      });
      if(!res.ok)throw new Error(`OLLAMA_HTTP_${res.status}`);
      const json=await res.json() as any;const message=json.message??{};
      if(host.now()-started>=timeout)throw new Error("TASK_TIMEOUT");
      for(const key of ['total_duration','load_duration','prompt_eval_duration','eval_duration','prompt_eval_count'])if(typeof json[key]==='number')totals[key]=(totals[key]??0)+json[key];
      totalTokens+=Number(json.eval_count)||0;messages.push({role:'assistant',...message});
      const calls=message.tool_calls??[];
      if(!calls.length){const text=String(message.content??'').trim();if(!text)throw Error('EMPTY_MODEL_OUTPUT');return {text,tokens_out:totalTokens,usage:ollamaUsage({...totals,eval_count:totalTokens})};}
      if(calls.length>4)throw Error('WORKER_TOOL_LIMIT');
      for(const call of calls){
        let result:unknown;try{result=invokeWorkerTool(call.function.name,call.function.arguments,notes);}catch(error){result={error:(error as Error).message};}
        messages.push({role:'tool',tool_name:call.function.name,content:JSON.stringify(result)});
      }
      if(totalTokens>=totalBudget)throw Error('WORKER_TOKEN_LIMIT');
    }
    throw Error('WORKER_TOOL_LIMIT');
  }, timeout);
}
