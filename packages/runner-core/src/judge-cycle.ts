import { Envelope, KeyDescriptor, type JudgeTaskOutput } from "@atm/shared";
import { keypairFromSecretB64 } from "@atm/crypto";
import type { RunnerHost } from "./index.js";
import { infraReasonCode, judge, replacementFor, type JudgeTaskOpts, type JudgeUsage, type ReplacementStatus } from "./judge.js";
import { FetchMarketplace } from "./marketplace.js";

export interface JudgeCycleOpts {
  marketplace_url: string;
  judge_model?: string;
  anthropic_url?: string;
  max_attempts?: number;
  retry_backoff_ms?: number;
  model_timeout_ms?: number;
}

/** Server-side review state returned for a deferral (contract v0.3 §8.2); null on a v0.2 server. */
export type ServerReview = { status: string; attempts: number; retry_at: string | null } | null;

export type JudgeCycleOutput =
  | { idle: true }
  | {
      idle: false;
      kind: "deferred";
      /** No verdict was recorded: the judge's own infrastructure failed. The seller is not penalised and the task returns to review. */
      deferred: true;
      task_id: string;
      result_id: string;
      failure_code: string;
      /** v0.3: the infrastructure code reported to the server; null when the server predates v0.3 and nothing was sent. */
      reported_code: string | null;
      review: ServerReview;
      usage: JudgeUsage[];
    }
  | {
      idle: false;
      kind: "verdict";
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
    }
  | {
      idle: false;
      kind: "replacement";
      deferred: false;
      task_id: string;
      result_id: string;
      /** delivered: sealed answer accepted; retry: provider failed, reported with an infrastructure code. */
      outcome: "delivered" | "retry";
      failure_code: string | null;
      replacement_status: string | null;
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

interface ReplacementPackage {
  task_id: string;
  result_id: string;
  payload_enc_judge: unknown;
  buyer_public_key: unknown;
  attempts?: number;
}

/**
 * One judge round inside one instance. Reviews come first; when none is
 * waiting and the server supports it (contract v0.3), one pending replacement
 * answer is produced. The agent key, judge private key and model key come
 * from the sandbox's secret store; only public metadata leaves.
 */
export async function judgeCycle(host: RunnerHost, opts: JudgeCycleOpts): Promise<JudgeCycleOutput> {
  const [apiKey, judgeSecret] = await Promise.all([host.getSecret("AGENT_API_KEY"), host.getSecret("JUDGE_PRIVATE_KEY_B64")]);
  if (!apiKey) throw new Error("MISSING_AGENT_API_KEY");
  if (!judgeSecret) throw new Error("MISSING_JUDGE_PRIVATE_KEY");
  const judgeKey = keypairFromSecretB64(judgeSecret);
  const mp = new FetchMarketplace(opts.marketplace_url, apiKey, host.fetch);
  // v0.3 is detected by its judge tools; CONTRACT_VERSION alone does not change.
  const tools = new Set(await mp.toolNames());
  const v03 = tools.has("fetch_replacement_package") && tools.has("submit_replacement");
  const base = (buyer: unknown): JudgeTaskOpts => ({
    buyer_public_key: KeyDescriptor.parse(buyer), judge_model: opts.judge_model, anthropic_url: opts.anthropic_url,
    max_attempts: opts.max_attempts, retry_backoff_ms: opts.retry_backoff_ms, model_timeout_ms: opts.model_timeout_ms,
  });

  const { package: pkg } = await mp.call<{ package: ReviewPackage | null }>("fetch_review_package");
  if (pkg) {
    const outcome = await judge(host, Envelope.parse(pkg.payload_enc_judge), Envelope.parse(pkg.result_enc_judge), { ...base(pkg.buyer_public_key), commitment_sha256: pkg.commitment_sha256 }, judgeKey);
    if (outcome.kind === "deferred") {
      // J2. v0.3 server: report the infrastructure code; it records a deferral with backoff (no verdict,
      // strike or money). v0.2 server: send nothing, since it would count any REJECT as a strike; its
      // JUDGING timeout (10 min) requeues the task.
      if (!v03) return { idle: false, kind: "deferred", deferred: true, task_id: pkg.task_id, result_id: pkg.result_id, failure_code: outcome.failure_code, reported_code: null, review: null, usage: outcome.usage };
      const code = infraReasonCode(outcome.failure_code);
      const res = await mp.call<{ deferred?: boolean; review?: ServerReview }>("submit_verdict", { task_id: pkg.task_id, result_id: pkg.result_id, verdict: "REJECT", reason_code: code });
      if (res.deferred !== true) throw new Error("JUDGE_DEFERRAL_NOT_ACCEPTED");
      return { idle: false, kind: "deferred", deferred: true, task_id: pkg.task_id, result_id: pkg.result_id, failure_code: outcome.failure_code, reported_code: code, review: res.review ?? null, usage: outcome.usage };
    }
    const v = outcome.output;
    const res = await mp.call<{ seller_status?: string | null; settlement?: { seller_payout_cents: number; note: string | null } }>("submit_verdict", {
      task_id: pkg.task_id, result_id: pkg.result_id, verdict: v.verdict, reason_code: v.reason_code,
      reason_public: v.reason_public, score: v.score, replacement_enc_buyer: v.replacement_enc_buyer,
    });
    return {
      idle: false, kind: "verdict", deferred: false, task_id: pkg.task_id, result_id: pkg.result_id, verdict: v.verdict, reason_code: v.reason_code,
      reason_public: v.reason_public, score: v.score, replacement_status: outcome.replacement_status, replacement_failure_code: outcome.replacement_failure_code,
      seller_status: res.seller_status ?? null, seller_payout_cents: res.settlement?.seller_payout_cents ?? null, settlement_note: res.settlement?.note ?? null,
      usage: outcome.usage,
    };
  }

  if (!v03) return { idle: true };
  // J3: a REJECTED task whose judge answer is still PENDING. Never moves money or reputation.
  const { package: rp } = await mp.call<{ package: ReplacementPackage | null }>("fetch_replacement_package");
  if (!rp) return { idle: true };
  const rep = await replacementFor(host, Envelope.parse(rp.payload_enc_judge), base(rp.buyer_public_key), judgeKey);
  const res = await mp.call<{ task?: { replacement_status?: string | null }; replacement_status?: string | null }>(
    "submit_replacement",
    rep.envelope
      ? { task_id: rp.task_id, result_id: rp.result_id, replacement_enc_buyer: rep.envelope }
      : { task_id: rp.task_id, result_id: rp.result_id, reason_code: infraReasonCode(rep.failure_code ?? "JUDGE_PROVIDER_FAILED") },
  );
  return {
    idle: false, kind: "replacement", deferred: false, task_id: rp.task_id, result_id: rp.result_id,
    outcome: rep.envelope ? "delivered" : "retry", failure_code: rep.failure_code,
    replacement_status: res.replacement_status ?? res.task?.replacement_status ?? null, usage: rep.usage,
  };
}
