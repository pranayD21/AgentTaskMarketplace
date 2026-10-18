import { Envelope, KeyDescriptor, type JudgeTaskOutput } from "@atm/shared";
import { keypairFromSecretB64 } from "@atm/crypto";
import type { RunnerHost } from "./index.js";
import { judge, type JudgeUsage, type ReplacementStatus } from "./judge.js";
import { FetchMarketplace } from "./marketplace.js";

export interface JudgeCycleOpts {
  marketplace_url: string;
  judge_model?: string;
  anthropic_url?: string;
  max_attempts?: number;
  retry_backoff_ms?: number;
  model_timeout_ms?: number;
}

export type JudgeCycleOutput =
  | { idle: true }
  | {
      idle: false;
      /** No verdict was submitted: the judge's own infrastructure failed. The seller is not penalised and the task returns to review. */
      deferred: true;
      task_id: string;
      result_id: string;
      failure_code: string;
      usage: JudgeUsage[];
    }
  | {
      idle: false;
      deferred: false;
      task_id: string;
      result_id: string;
      verdict: JudgeTaskOutput["verdict"];
      reason_code: JudgeTaskOutput["reason_code"];
      reason_public: string;
      score?: number;
      replacement_status: ReplacementStatus;
      replacement_failure_code: string | null;
      seller_status: string | null;
      seller_payout_cents: number | null;
      settlement_note: string | null;
      usage: JudgeUsage[];
    };

interface ReviewPackage {
  task_id: string;
  result_id: string;
  payload_enc_judge: unknown;
  result_enc_judge: unknown;
  commitment_sha256: string;
  buyer_public_key: unknown;
}

/**
 * One judge round inside one instance: fetch the review package, decrypt and
 * grade, submit the verdict. The agent key, judge private key and model key
 * come from the sandbox's secret store; only public metadata leaves.
 */
export async function judgeCycle(host: RunnerHost, opts: JudgeCycleOpts): Promise<JudgeCycleOutput> {
  const [apiKey, judgeSecret] = await Promise.all([host.getSecret("AGENT_API_KEY"), host.getSecret("JUDGE_PRIVATE_KEY_B64")]);
  if (!apiKey) throw new Error("MISSING_AGENT_API_KEY");
  if (!judgeSecret) throw new Error("MISSING_JUDGE_PRIVATE_KEY");
  const mp = new FetchMarketplace(opts.marketplace_url, apiKey, host.fetch);
  const { package: pkg } = await mp.call<{ package: ReviewPackage | null }>("fetch_review_package");
  if (!pkg) return { idle: true };
  const outcome = await judge(
    host,
    Envelope.parse(pkg.payload_enc_judge),
    Envelope.parse(pkg.result_enc_judge),
    {
      buyer_public_key: KeyDescriptor.parse(pkg.buyer_public_key), judge_model: opts.judge_model, anthropic_url: opts.anthropic_url,
      commitment_sha256: pkg.commitment_sha256, max_attempts: opts.max_attempts, retry_backoff_ms: opts.retry_backoff_ms, model_timeout_ms: opts.model_timeout_ms,
    },
    keypairFromSecretB64(judgeSecret),
  );
  // J2: no submit_verdict, so no strike and no settlement. The server returns
  // the task from JUDGING to SUBMITTED after its review timeout (10 min), and
  // the next judge round grades it again.
  if (outcome.kind === "deferred") return { idle: false, deferred: true, task_id: pkg.task_id, result_id: pkg.result_id, failure_code: outcome.failure_code, usage: outcome.usage };
  const v = outcome.output;
  const res = await mp.call<{ seller_status?: string | null; settlement?: { seller_payout_cents: number; note: string | null } }>("submit_verdict", {
    task_id: pkg.task_id, result_id: pkg.result_id, verdict: v.verdict, reason_code: v.reason_code,
    reason_public: v.reason_public, score: v.score, replacement_enc_buyer: v.replacement_enc_buyer,
  });
  return {
    idle: false, deferred: false, task_id: pkg.task_id, result_id: pkg.result_id, verdict: v.verdict, reason_code: v.reason_code,
    reason_public: v.reason_public, score: v.score, replacement_status: outcome.replacement_status, replacement_failure_code: outcome.replacement_failure_code,
    seller_status: res.seller_status ?? null, seller_payout_cents: res.settlement?.seller_payout_cents ?? null, settlement_note: res.settlement?.note ?? null,
    usage: outcome.usage,
  };
}
