import { MarketplaceError, isAllowlistedModel, type ClaimPublic, type KeyDescriptor } from "@atm/shared";
import { safeFailureCode, safeSellerUsage, type SellerUsage, type SellerRegistration } from "@atm/runner-core";
import { Marketplace } from "./marketplace.js";
import { listOllamaModels } from "./ollama.js";
import type { MeasurementRecorder, AttemptResult } from "./measurements.js";
import type { Runtime } from "./runtime/types.js";
import { requireTaskPricing, selectOfferedTask, type OfferedTask } from "./task-pricing.js";

export interface SellerOptions {
  marketplaceUrl: string; ollamaUrl: string; pollMs: number;
  models?: string[]; once: boolean; taskId?: string;
  log: (...args: unknown[]) => void;
  measurements?: MeasurementRecorder;
  canary?: boolean;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sellerLoop(mp: Marketplace, rt: Runtime, opts: SellerOptions) {
  const { log } = opts;
  const info = await mp.call<{ models: { model_id: string }[] }>("marketplace_info");
  requireTaskPricing(info);
  const local = await listOllamaModels(opts.ollamaUrl);
  const wanted = opts.models?.length ? new Set(opts.models) : null;
  const models = local.filter((m) => isAllowlistedModel(m.model_id) && (!wanted || wanted.has(m.model_id)))
    .map((m) => ({ model_id: m.model_id, digest: m.digest }));
  if (!models.length) {
    log(`No installed allowlisted models. Local: ${local.map((m) => m.model_id).join(", ") || "none"}. Allowed: ${info.models.map((m) => m.model_id).join(", ")}`);
    throw new Error("NO_ELIGIBLE_LOCAL_MODELS");
  }
  await rt.prepare?.();
  const runtime = rt.info();
  if (opts.canary) for (const model of models) {
    const finish = opts.measurements?.begin({ kind: "model_canary", model_id: model.model_id, model_digest: model.digest });
    try {
      if (!rt.modelCanary) throw new Error("CANARY_UNSUPPORTED");
      const out = await rt.modelCanary({ ollama_url: opts.ollamaUrl, model_id: model.model_id });
      finish?.({ status: out.passed ? "passed" : "failed", ...out, error_code: out.passed ? undefined : "CANARY_MISMATCH" });
      log(`canary model=${model.model_id} passed=${out.passed}; local liveness only, not attestation`);
      if (!out.passed) throw new Error("CANARY_MISMATCH");
    } catch (error) { finish?.({ status: "failed", error_code: safeFailureCode(error) }); throw error; }
  }
  const registration: SellerRegistration = {
    models, runtime: runtime.runtime, runner_wasm_sha256: runtime.wasm_sha256 ?? undefined, wassette_version: runtime.wassette_version ?? undefined,
  };
  const keyMode = rt.runCycle ? await mp.sellerKeyMode() : "registered";
  const publicKey = keyMode === "registered" ? await rt.getPublicKey() : undefined;
  const reg = await mp.call<{ seller: { status: string } }>("register_seller", {
    ...registration, ...(publicKey ? { runner_pubkey_b64: publicKey.public_key_b64, runner_key_id: publicKey.key_id } : {}),
  });
  log(`listed ${models.map((m) => m.model_id).join(", ")} | pricing=task_offer | runtime=${runtime.runtime} | key mode=${keyMode} | status=${reg.seller.status}`);
  if (reg.seller.status === "SUSPENDED") { log("SELLER_SUSPENDED: stopping"); return; }
  if (rt.runCycle) log("Single sandbox call per task; inference capped at 180s within the 300s lease; no host lease renewal.");

  for (;;) {
    let taskId: string | undefined;
    let finish: ((result: AttemptResult) => void) | undefined;
    let usage: SellerUsage | null = null;
    try {
      const { tasks } = await mp.call<{ tasks: OfferedTask[] }>("list_open_tasks");
      const task = selectOfferedTask(tasks, models.map((m) => m.model_id), opts.taskId);
      if (!task) { if (opts.once) { log("No eligible open tasks"); return; } await sleep(opts.pollMs); continue; }
      taskId = task.task_id;
      const model = task.eligible_models.find((id) => models.some((m) => m.model_id === id))!;
      finish = opts.measurements?.begin({ kind: "task_attempt", task_id: taskId, model_id: model, model_digest: models.find((m) => m.model_id === model)?.digest, job_id: task.job_id, part_key: task.part_key, task_attempt: task.attempt, offered_price_cents: task.price_cents });
      if (rt.runCycle) {
        log(`accepting ${taskId} offer=${task.price_cents}c model=${model} runtime=wassette`);
        const out = await rt.runCycle({
          marketplace_url: opts.marketplaceUrl, ollama_url: opts.ollamaUrl, task_id: taskId, model_id: model, max_runtime_s: task.max_runtime_s, expected_price_cents: task.price_cents,
          ...(keyMode === "registered" ? { legacy_registration: registration } : {}),
        });
        finish?.({ status: "submitted", ...out });
        log(`claimed ${out.task_id} (${out.claim_id}); submitted ${out.result_id} in ${out.runtime_ms}ms (${out.tokens_out ?? "?"} tokens); key=${out.key_id}; runtime=wassette`);
      } else {
        const { claim } = await mp.call<{ claim: ClaimPublic }>("claim_task", { task_id: taskId, model_id: model });
        if (claim.price_cents !== task.price_cents) {
          await mp.call("release_task", { task_id: taskId, claim_id: claim.claim_id, reason: "TASK_PRICE_CHANGED" });
          throw new Error("TASK_PRICE_CHANGED");
        }
        log(`claimed ${taskId} (${claim.claim_id}) agreed_price=${claim.price_cents}c model=${model} runtime=node-unsandboxed`);
        const out = await runNodeClaim(mp, rt, claim, opts, (value) => { usage = value; });
        finish?.({ status: "submitted", ...out, claim_id: claim.claim_id });
      }
      if (opts.once) return;
    } catch (error) {
      const code = safeFailureCode(error);
      finish?.({ status: "failed", error_code: code, seller_usage: safeSellerUsage((error as { seller_usage?: unknown })?.seller_usage) ?? usage });
      log(`seller: ${code}`);
      if (code === "SELLER_SUSPENDED") return;
      // runCycle closes a crashed process first. Recover an active claim using metadata only.
      if (taskId && code !== "CLAIM_CONFLICT") await recoverClaim(mp, taskId, log);
      if (opts.once) throw new Error(code);
      await sleep(opts.pollMs);
    }
  }
}

export async function recoverClaim(mp: Pick<Marketplace, "call">, taskId: string, log: (...args: unknown[]) => void) {
  try {
    const { task } = await mp.call<{ task: { status: string; claim_id?: string } }>("get_task", { task_id: taskId });
    if (task.claim_id && ["PAYLOAD_READY", "RUNNING"].includes(task.status)) {
      await mp.call("release_task", { task_id: taskId, claim_id: task.claim_id, reason: "RUNNER_INTERRUPTED" });
      log(`released ${taskId} after interrupted execution`);
    } else log(`recovery ${taskId}: ${task.status}`);
  } catch { log(`recovery ${taskId}: unavailable; the 300s lease bounds abandoned claims`); }
}

async function runNodeClaim(mp: Marketplace, rt: Runtime, claim: ClaimPublic, opts: SellerOptions, observed: (value: SellerUsage | null) => void) {
  let renew: ReturnType<typeof setInterval> | undefined;
  let lostLease = false;
  try {
    await mp.call("start_task", { task_id: claim.task_id, claim_id: claim.claim_id });
    const keys = await mp.call<{ buyer_public_key: KeyDescriptor; judge_public_key: KeyDescriptor }>("get_recipient_keys", { task_id: claim.task_id, claim_id: claim.claim_id });
    renew = setInterval(() => {
      void mp.call("renew_lease", { task_id: claim.task_id, claim_id: claim.claim_id }).catch((error) => {
        if (error instanceof MarketplaceError && ["LEASE_EXPIRED", "SELLER_SUSPENDED"].includes(error.code)) lostLease = true;
        opts.log(`renewal ${claim.task_id}: ${safeFailureCode(error)}`);
      });
    }, 120_000);
    const out = await rt.runTask(claim.seller_envelope, {
      ollama_url: opts.ollamaUrl, model_id: claim.model_id, ...keys, timeout_ms: Math.min(claim.max_runtime_s, 180) * 1000,
      expected_task_id: claim.task_id, expected_claim_id: claim.claim_id,
    });
    observed(out.seller_usage ?? null);
    if (lostLease) throw new MarketplaceError("LEASE_EXPIRED", "LEASE_EXPIRED");
    const res = await mp.call<{ result_id: string }>("submit_result", { task_id: claim.task_id, claim_id: claim.claim_id,
      result_enc_buyer: out.result_enc_buyer, result_enc_judge: out.result_enc_judge,
      commitment_sha256: out.commitment_sha256, runtime_ms: out.runtime_ms, tokens_out: out.tokens_out,
    });
    opts.log(`submitted ${res.result_id} for ${claim.task_id} in ${out.runtime_ms}ms; runtime=node-unsandboxed (UNSANDBOXED)`);
    return { result_id: res.result_id, runtime_ms: out.runtime_ms, seller_usage: out.seller_usage };
  } catch (error) {
    await mp.call("release_task", { task_id: claim.task_id, claim_id: claim.claim_id, reason: safeFailureCode(error) }).catch(() => {});
    throw error;
  } finally { if (renew) clearInterval(renew); }
}
