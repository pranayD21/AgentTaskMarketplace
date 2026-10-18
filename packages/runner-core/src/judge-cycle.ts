import { Envelope, KeyDescriptor, type JudgeTaskOutput } from "@atm/shared";
import { keypairFromSecretB64 } from "@atm/crypto";
import { createRunner, type RunnerHost } from "./index.js";
import { FetchMarketplace } from "./marketplace.js";

export interface JudgeCycleOpts {
  marketplace_url: string;
  judge_model?: string;
  anthropic_url?: string;
}

export type JudgeCycleOutput =
  | { idle: true }
  | {
      idle: false;
      task_id: string;
      result_id: string;
      verdict: JudgeTaskOutput["verdict"];
      reason_code: JudgeTaskOutput["reason_code"];
      reason_public: string;
      score?: number;
      seller_status: string | null;
      seller_payout_cents: number | null;
      settlement_note: string | null;
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
 * come from the sandbox's secret store; only the public verdict summary leaves.
 */
export async function judgeCycle(host: RunnerHost, opts: JudgeCycleOpts): Promise<JudgeCycleOutput> {
  const [apiKey, judgeSecret] = await Promise.all([host.getSecret("AGENT_API_KEY"), host.getSecret("JUDGE_PRIVATE_KEY_B64")]);
  if (!apiKey) throw new Error("MISSING_AGENT_API_KEY");
  if (!judgeSecret) throw new Error("MISSING_JUDGE_PRIVATE_KEY");
  const mp = new FetchMarketplace(opts.marketplace_url, apiKey, host.fetch);
  const { package: pkg } = await mp.call<{ package: ReviewPackage | null }>("fetch_review_package");
  if (!pkg) return { idle: true };
  const verdict = await createRunner(host).judgeTask(
    Envelope.parse(pkg.payload_enc_judge),
    Envelope.parse(pkg.result_enc_judge),
    { buyer_public_key: KeyDescriptor.parse(pkg.buyer_public_key), judge_model: opts.judge_model, anthropic_url: opts.anthropic_url, commitment_sha256: pkg.commitment_sha256 },
    keypairFromSecretB64(judgeSecret),
  );
  const res = await mp.call<{ seller_status?: string | null; settlement?: { seller_payout_cents: number; note: string | null } }>("submit_verdict", {
    task_id: pkg.task_id, result_id: pkg.result_id, verdict: verdict.verdict, reason_code: verdict.reason_code,
    reason_public: verdict.reason_public, score: verdict.score, replacement_enc_buyer: verdict.replacement_enc_buyer,
  });
  return {
    idle: false, task_id: pkg.task_id, result_id: pkg.result_id, verdict: verdict.verdict, reason_code: verdict.reason_code,
    reason_public: verdict.reason_public, score: verdict.score, seller_status: res.seller_status ?? null,
    seller_payout_cents: res.settlement?.seller_payout_cents ?? null, settlement_note: res.settlement?.note ?? null,
  };
}
