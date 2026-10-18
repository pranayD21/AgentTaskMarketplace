import { ClaimPublic, KeyDescriptor, LEASE_SECONDS, MarketplaceError, type ModelInfo } from "@atm/shared";
import { createRunner, type RunnerHost } from "./index.js";
import { FetchMarketplace, safeFailureCode } from "./marketplace.js";

export interface SellerRegistration {
  models: ModelInfo[];
  runtime: "wassette" | "node-unsandboxed";
  runner_wasm_sha256?: string;
  wassette_version?: string;
}

export interface RunCycleOpts {
  marketplace_url: string;
  ollama_url: string;
  task_id: string;
  model_id: string;
  max_runtime_s: number;
  /** Only for servers that still require a registered key. */
  legacy_registration?: SellerRegistration;
}

export interface RunCycleOutput {
  task_id: string;
  claim_id: string;
  result_id: string;
  runtime_ms: number;
  tokens_out?: number;
  key_id: string;
}

/** A fresh runner and key stay alive for the complete claim-to-submit call. */
export async function runCycle(host: RunnerHost, opts: RunCycleOpts): Promise<RunCycleOutput> {
  if (!Number.isFinite(opts.max_runtime_s) || opts.max_runtime_s <= 0) throw new Error("INVALID_RUNTIME_LIMIT");
  const apiKey = await host.getSecret("AGENT_API_KEY");
  if (!apiKey) throw new Error("MISSING_AGENT_API_KEY");
  const mp = new FetchMarketplace(opts.marketplace_url, apiKey, host.fetch);
  const runner = createRunner(host);
  const key = runner.getPublicKey();
  const keyFields = { runner_pubkey_b64: key.public_key_b64, runner_key_id: key.key_id };
  if (opts.legacy_registration) {
    await mp.call("register_seller", { ...opts.legacy_registration, ...keyFields });
  }
  const claimed = await mp.call<{ claim: unknown; buyer_public_key?: unknown; judge_public_key?: unknown }>("claim_task", {
    task_id: opts.task_id, model_id: opts.model_id, ...(opts.legacy_registration ? {} : keyFields),
  });
  const raw = claimed.claim as Record<string, unknown>;
  // Keep the ID for cleanup even if the rest of the response fails validation.
  const claimId = typeof raw?.claim_id === "string" ? raw.claim_id : undefined;
  try {
    const claim = ClaimPublic.parse(raw);
    if (claim.task_id !== opts.task_id || claim.model_id !== opts.model_id) throw new Error("CLAIM_MISMATCH");
    const leaseRemaining = Date.parse(claim.lease_expires_at) - host.now();
    if (!Number.isFinite(leaseRemaining) || leaseRemaining < 40_000) throw new MarketplaceError("LEASE_EXPIRED", "LEASE_EXPIRED");
    await mp.call("start_task", { task_id: opts.task_id, claim_id: claim.claim_id });
    const embeddedBuyer = raw.buyer_public_key ?? claimed.buyer_public_key;
    const embeddedJudge = raw.judge_public_key ?? claimed.judge_public_key;
    const recipients = embeddedBuyer && embeddedJudge
      ? { buyer_public_key: embeddedBuyer, judge_public_key: embeddedJudge }
      : await mp.call<{ buyer_public_key: unknown; judge_public_key: unknown }>("get_recipient_keys", { task_id: opts.task_id, claim_id: claim.claim_id });
    // Reserve time for registration, transport and submission. No lease renewal is needed.
    const timeoutMs = Math.min(opts.max_runtime_s, claim.max_runtime_s, 180, LEASE_SECONDS - 60) * 1000;
    const remaining = Date.parse(claim.lease_expires_at) - host.now() - 30_000;
    if (remaining <= 0) throw new MarketplaceError("LEASE_EXPIRED", "LEASE_EXPIRED");
    const out = await runner.runTask(claim.seller_envelope, {
      ollama_url: opts.ollama_url, model_id: opts.model_id,
      buyer_public_key: KeyDescriptor.parse(recipients.buyer_public_key),
      judge_public_key: KeyDescriptor.parse(recipients.judge_public_key),
      timeout_ms: Math.min(timeoutMs, remaining), expected_task_id: opts.task_id, expected_claim_id: claim.claim_id,
    });
    const submitted = await mp.call<{ result_id: string }>("submit_result", {
      task_id: opts.task_id, claim_id: claim.claim_id,
      result_enc_buyer: out.result_enc_buyer, result_enc_judge: out.result_enc_judge,
      commitment_sha256: out.commitment_sha256, runtime_ms: out.runtime_ms, tokens_out: out.tokens_out,
    });
    if (!submitted.result_id) throw new Error("MISSING_RESULT_ID");
    return { task_id: opts.task_id, claim_id: claim.claim_id, result_id: submitted.result_id, runtime_ms: out.runtime_ms, tokens_out: out.tokens_out, key_id: key.key_id };
  } catch (error) {
    if (claimId) await mp.call("release_task", { task_id: opts.task_id, claim_id: claimId, reason: safeFailureCode(error) }).catch(() => {});
    throw error;
  }
}
