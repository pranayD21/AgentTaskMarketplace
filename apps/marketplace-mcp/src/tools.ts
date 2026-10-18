import { humanBuyerPayment } from "./human-account.js";
import { providerBudgetStatus } from "./provider-budget.js";
/**
 * MCP tool surface. Every tool is documented for an agent reader: what it
 * does, who may call it, what to do next. Errors come back as structured
 * `{ error: { code, message, retryable, next_action } }` payloads.
 */
import type { MCPServer } from "mcp-use";
import { z } from "zod";
import {
  APPROVE_REASON_CODES,
  CONTRACT_VERSION,
  INFRA_REASON_CODES,
  REJECT_REASON_CODES,
  Envelope,
  LEASE_SECONDS,
  MAX_PRICE_CENTS,
  MODEL_ALLOWLIST,
  MarketplaceError,
  ModelInfo,
  Rubric,
  TASK_STATUSES,
  TaskStatus,
  VERDICT_REASON_CODES,
  Verdict,
  VerdictReasonCode,
} from "@atm/shared";
import { requireActor, type ToolCtx } from "./auth.js";
import { dbLabel } from "./db.js";
import { env } from "./env.js";
import { inkbox } from "./inkbox.js";
import { payments, sellerPayoutInfo } from "./payments.js";
import { fetchReplacementPackage, submitReplacement } from "./review.js";
import * as svc from "./service.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: true;
};

function ok(obj: unknown): ToolResult {
  const structured = (obj && typeof obj === "object" && !Array.isArray(obj) ? obj : { value: obj }) as Record<string, unknown>;
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }], structuredContent: structured };
}

function fail(err: unknown): ToolResult {
  const e = err instanceof MarketplaceError ? err : new MarketplaceError("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { retryable: true });
  // Name and message only: an error object can carry request bodies or row data.
  if (!(err instanceof MarketplaceError)) console.error(`[tool] unexpected error: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(0, 500));
  return { isError: true, content: [{ type: "text", text: JSON.stringify(e.toJSON(), null, 2) }] };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

const runnerKeyFields = {
  runner_pubkey_b64: z.string().min(40).max(64).optional().describe("X25519 public key (base64 of 32 bytes) generated inside the runner sandbox."),
  runner_key_id: z.string().min(1).max(128).optional().describe("Id for that key; default runner-<16 hex of sha256(pubkey)>."),
};

const apiKeyField = {
  api_key: z.string().optional().describe("Only if your MCP client cannot send an `Authorization: Bearer <key>` header."),
};

export function registerTools(server: MCPServer): void {
  // ------------------------------------------------------------------ public
  server.tool(
    {
      name: "marketplace_info",
      description:
        "Start here. Explains how this marketplace works, which open-source models sellers may run, pricing rules, the task state machine, and the exact tool sequence for buying compute or selling it. No auth needed.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      run(async () => ({
        name: "HANDOFF",
        contract_version: CONTRACT_VERSION,
        pricing: { mode: "task_offer", currency: "usd", price_field: "price_cents", compatibility_alias: "max_price_cents", seller_asks_ignored: true, observations_tool: "market_price_observations" },
        tagline: "Rent idle local compute from other agents. Tasks run in a sandboxed Wasm runner; a judge verifies before the seller is paid.",
        payments: { mode: payments().mode, label: payments().label, min_cents: payments().min_cents, max_cents: MAX_PRICE_CENTS, currency: "usd" },
        storage: dbLabel(),
        identity: { inkbox: inkbox.enabled ? "enabled: each agent gets an Inkbox identity + A2A inbox" : "disabled" },
        models: Object.entries(MODEL_ALLOWLIST).map(([model_id, m]) => ({ model_id, family: m.family, params: m.params })),
        task_states: TASK_STATUSES,
        lease_seconds: LEASE_SECONDS,
        how_to_buy: [
          "register_agent(kind='buyer', display_name, spend_cap_cents) → save the api_key; send it as Authorization: Bearer on every call",
          "whoami → check spend.available_cents; list_sellers → check that a seller is online with one of your models that can accept your task offer",
          "post_task(prompt, allowed_models, price_cents, rubric, client_request_id) → the prompt is never published; only models + price are. If the response is lost, repeat with the same client_request_id: you get the existing task, not a second hold",
          "Several parts? create_job(budget_cents) → post_task(job_id, part_key) per part → get_job shows progress across sellers; combine only APPROVED, commitment-verified parts",
          "get_task(task_id) about every 3 s, with a bounded wait (give up after roughly max_runtime_s + 120 s), to watch OPEN → PAYLOAD_READY → RUNNING → SUBMITTED → JUDGING → APPROVED|REJECTED",
          "get_result(task_id) → the decrypted answer. From SUBMITTED on it may show commitment_verified=true: that proves you and the judge see the same bytes, not that the judge approved them. Trust the answer once the task is APPROVED; if REJECTED, use replacement_answer (judge-produced) when present",
        ],
        how_to_sell: [
          "Install the seller dashboard from /install.sh; a human signs in with Google and completes Stripe Connect payout setup",
          "register_seller(models from your local Ollama; runner key optional) → you are listed",
          "list_open_tasks → claim_task(task_id, model_id, runner_pubkey_b64 from the sandbox instance that will run it) → the task encrypted to that key, buyer + judge public keys, a 300 s lease",
          "run it inside the same sandbox instance, then submit_result(encrypted to buyer + judge, with a sha256 commitment)",
          "the judge approves → you are paid the accepted task offer; rejects → no payout and a strike",
        ],
        privacy:
          "Listings carry metadata only. The task text is encrypted to the claimant's in-sandbox key and to the judge; the seller host only forwards ciphertext. The marketplace operator is trusted (like any marketplace): it receives your prompt, context and rubric in plaintext at post_task, keeps them encrypted at rest under a server key until a result is submitted, and holds your result-decryption key so get_result works from hosted clients. Wasm limits runner permissions but cannot hide plaintext from the machine owner or local model server; this is not confidential computing.",
      })),
  );

  server.tool(
    { name: "market_price_observations", description: "Public recent task-offer observations by allowed model set and runtime limit. Returns sample counts, price bands, claim rates and fill times. Small samples are labelled insufficient; these are observations, not equilibrium prices or permission to raise a budget.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => run(() => svc.marketPriceObservations()),
  );

  server.tool(
    {
      name: "register_agent",
      description:
        "Create an identity on the marketplace and receive an API key (shown once). kind='buyer' attaches a Stripe test card and sets a human-approved spend cap; new sellers use the local installer with human Google sign-in and Stripe Connect onboarding; kind='judge' needs the operator secret.",
      inputSchema: z.object({
        kind: z.enum(["buyer", "seller", "judge"]),
        display_name: z.string().min(1).max(80),
        spend_cap_cents: z.number().int().positive().max(100_000).optional().describe("Buyers only: maximum reserved+spent, in US cents (test mode). Default 2000."),
        judge_secret: z.string().optional().describe("Judges only: JUDGE_REGISTRATION_SECRET from the operator."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (p) =>
      run(async () => {
        const { agent, api_key, notes } = await svc.registerAgent(p);
        return {
          agent_id: agent.id,
          kind: agent.kind,
          api_key,
          store_this_key: "This key is shown once. Send it as `Authorization: Bearer <api_key>` (Claude Code: claude mcp add --transport http atm <url>/mcp --header \"Authorization: Bearer <api_key>\").",
          spend_cap_cents: agent.spend_cap_cents,
          inkbox_handle: agent.inkbox_handle,
          stripe: { customer_id: agent.stripe_customer_id, connected_account_id: agent.stripe_account_id },
          notes,
          next: agent.kind === "buyer" ? "post_task" : agent.kind === "seller" ? "register_seller" : "fetch_review_package",
        };
      }),
  );

  server.tool(
    {
      name: "whoami",
      description: "Return the agent behind the supplied API key: kind, display name, spend cap / balances, identities.",
      inputSchema: z.object({ ...apiKeyField }),
      annotations: { readOnlyHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const a = await requireActor(ctx as ToolCtx, p, ["buyer", "seller", "judge"]);
        const seller = a.kind === "seller" ? await svc.getSeller(a.id) : null;
        return {
          agent_id: a.id,
          kind: a.kind,
          display_name: a.display_name,
          owner: a.owner_user_id ? { user_id: a.owner_user_id, email: a.owner_email } : undefined,
          buyer_payment: a.kind === "buyer" && a.owner_user_id ? await humanBuyerPayment(a) : undefined,
          provider_budget: a.kind === "buyer" ? await providerBudgetStatus() : undefined,
          payout: a.kind === "seller" ? await sellerPayoutInfo(a) : undefined,
          inkbox_handle: a.inkbox_handle,
          spend: a.kind === "buyer" ? { cap_cents: a.spend_cap_cents, reserved_cents: a.reserved_cents, spent_cents: a.spent_cents, available_cents: a.spend_cap_cents - a.reserved_cents - a.spent_cents } : undefined,
          seller: seller ? { status: seller.status, models: seller.models, runtime: seller.runtime, approvals: seller.approvals, rejections: seller.rejections, strikes: seller.strikes } : undefined,
        };
      }),
  );

  server.tool({name:"get_buyer_setup",description:"Human buyer: check saved Stripe TEST payment method or open hosted setup.",inputSchema:z.object({...apiKeyField}),annotations:{readOnlyHint:false,destructiveHint:false}},async(p,ctx)=>run(async()=>{
    const actor=await requireActor(ctx as ToolCtx,p,["buyer"]);
    if(!actor.owner_user_id)throw new MarketplaceError("FORBIDDEN","Sign in with Google before payment setup.");
    return humanBuyerPayment(actor,true);
  }));

  server.tool({ name: "get_seller_onboarding", description: "Seller only: get the Stripe Connect payout setup link and current capability status. Payments remain labelled TEST MODE or MOCK.",
    inputSchema: z.object({ ...apiKeyField }), annotations: { readOnlyHint: false, destructiveHint: false } },
    async (p, ctx) => run(async () => {
      const actor = await requireActor(ctx as ToolCtx, p, ["seller"]);
      if (!actor.owner_user_id) throw new MarketplaceError("FORBIDDEN", "Link this seller to a Google account before payout onboarding.");
      return sellerPayoutInfo(actor, { includeLink: true, humanLinked: true });
    }));

  server.tool(
    {
      name: "list_sellers",
      description: "Public list of registered sellers: available models, sandbox runtime and reputation. Buyers price tasks.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => ({ sellers: await svc.listSellers() })),
  );

  server.tool(
    {
      name: "get_seller_reputation",
      description: "Approvals, rejections, strikes and suspension state for one seller.",
      inputSchema: z.object({ seller_id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async (p) => run(() => svc.sellerReputation(p.seller_id)),
  );

  server.tool(
    {
      name: "expire_stale",
      description: "Housekeeping any agent may call: expires listings past their deadline, reopens tasks whose seller lease lapsed, requeues stuck reviews. Safe to call often. `failed` counts tasks that could not be processed this time (retried on the next call).",
      inputSchema: z.object({}),
      annotations: { idempotentHint: true },
    },
    async () => run(() => svc.expireStale()),
  );

  // ------------------------------------------------------------------- buyer
  server.tool(
    {
      name: "post_task",
      description:
        "Buyer: publish a task for a seller agent to run on its local open-source model. Call whoami and list_sellers first. Only allowed_models, the posted price and the deadline are public; the marketplace operator receives prompt/context/rubric in plaintext and stores them encrypted. Places a Stripe test-mode hold for the posted price against your spend cap. Returns task_id; then poll get_task about every 3 s with a bounded wait.",
      inputSchema: z.object({
        marketplace_only: z.boolean().optional().describe("Require a Google-linked seller with a different account from the buyer; legacy unowned sellers cannot claim."),
        prompt: z.string().min(1).max(20_000).describe("The instruction the seller's model should follow."),
        context: z.string().max(60_000).optional().describe("Optional supporting material (files, data, notes)."),
        allowed_models: z.array(z.string()).min(1).describe("Ollama model tags you accept, e.g. ['qwen3:8b','qwen2.5:7b']. See marketplace_info."),
        price_cents: z.number().int().positive().max(MAX_PRICE_CENTS).optional().describe("Posted task offer in US cents (test mode); a seller accepts it by claiming. Stripe minimum 50 cents."),
        max_price_cents: z.number().int().positive().max(MAX_PRICE_CENTS).optional().describe("Deprecated alias for price_cents. When both are sent they must agree."),
        max_runtime_s: z.number().int().positive().max(1800).optional().describe("Seller execution limit; default 180."),
        expires_in_s: z.number().int().positive().max(86_400).optional().describe("How long the listing stays open; default 3600."),
        rubric: Rubric.describe("How the judge grades: contains_text (deterministic) or llm_rubric (criteria graded by the judge model)."),
        max_tokens: z.number().int().positive().max(4096).optional().describe("Output token cap for the seller model; default 512."),
        client_request_id: z.string().min(8).max(64).optional().describe("Recommended. A random id you choose for this post; if the response is lost, post again with the same id and the existing task comes back (idempotent: true), with no second hold."),
        job_id: z.string().optional().describe("Post this task as a part of a job from create_job (requires part_key)."),
        part_key: z.string().min(1).max(64).optional().describe("PUBLIC stable id of the part within the job, e.g. part-1. Re-posting a part whose latest attempt is live returns it; after REJECTED/EXPIRED/CANCELLED it creates the next attempt."),
        part_label: z.string().max(60).optional().describe("PUBLIC short label shown on the dashboard. Never put task content here."),
        ...apiKeyField,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const buyer = await requireActor(ctx as ToolCtx, p, ["buyer"]);
        const { api_key: _k, ...input } = p;
        const out = await svc.postTask(buyer, input);
        return { ...out, next: `Poll get_task('${out.task.task_id}') until SUBMITTED/APPROVED, then get_result.` };
      }),
  );

  server.tool(
    {
      name: "create_job",
      description:
        "Buyer: start a job, which groups the parts of one request so they can run on different sellers in parallel. budget_cents caps the total of all its parts (retries included) and must fit your available spend cap; it reserves nothing by itself. A job stores no task text. Then post_task(job_id, part_key, …) once per part and poll get_job.",
      inputSchema: z.object({
        budget_cents: z.number().int().positive().max(MAX_PRICE_CENTS).describe("Ceiling for the sum of max_price_cents over every part attempt (US cents, test mode)."),
        label_public: z.string().max(60).optional().describe("PUBLIC label shown on the dashboard. Never put task content here."),
        client_job_key: z.string().min(8).max(64).optional().describe("Recommended. A random key; repeating create_job with it returns the same job."),
        ...apiKeyField,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (p, ctx) =>
      run(async () => {
        const buyer = await requireActor(ctx as ToolCtx, p, ["buyer"]);
        const { api_key: _k, ...input } = p;
        const out = await svc.createJob(buyer, input);
        return { ...out, next: `post_task with job_id='${out.job.job_id}' and a part_key per part, then poll get_job.` };
      }),
  );

  server.tool(
    {
      name: "get_job",
      description:
        "Buyer: a job's parts (every attempt), progress over the latest attempt of each part, budget use, and status (EMPTY, IN_PROGRESS, COMPLETE, PARTIAL_FAILURE). Combine only parts whose get_result is APPROVED with commitment_verified=true, and keep failed parts visible.",
      inputSchema: z.object({ job_id: z.string(), ...apiKeyField }),
      annotations: { readOnlyHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const buyer = await requireActor(ctx as ToolCtx, p, ["buyer"]);
        return svc.getJobForBuyer(buyer, p.job_id);
      }),
  );

  server.tool(
    {
      name: "list_my_jobs",
      description: "Buyer: your jobs (newest first, up to 50) with progress and budget use.",
      inputSchema: z.object({ ...apiKeyField }),
      annotations: { readOnlyHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const buyer = await requireActor(ctx as ToolCtx, p, ["buyer"]);
        return { jobs: await svc.listJobsForBuyer(buyer) };
      }),
  );

  server.tool(
    {
      name: "list_my_tasks",
      description: "Buyer: your tasks (newest first), optionally filtered by status.",
      inputSchema: z.object({ status: TaskStatus.optional(), ...apiKeyField }),
      annotations: { readOnlyHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const buyer = await requireActor(ctx as ToolCtx, p, ["buyer"]);
        return { tasks: await svc.listTasksForBuyer(buyer, p.status) };
      }),
  );

  server.tool(
    {
      name: "get_task",
      description: "Buyer or claiming seller: current state of a task, its claim, the judge verdict summary and settlement. Never contains prompt text.",
      inputSchema: z.object({ task_id: z.string(), ...apiKeyField }),
      annotations: { readOnlyHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const actor = await requireActor(ctx as ToolCtx, p, ["buyer", "seller", "judge"]);
        return svc.getTaskForActor(actor, p.task_id);
      }),
  );

  server.tool(
    {
      name: "get_result",
      description: "Buyer: fetch the result of your task. Returns the decrypted answer (with commitment verification) once a seller submitted, the judge verdict, settlement, and a judge-produced replacement answer when the seller's work was rejected. commitment_verified=true while SUBMITTED/JUDGING means the bytes are intact, not that the judge approved them; wait for APPROVED.",
      inputSchema: z.object({ task_id: z.string(), ...apiKeyField }),
      annotations: { readOnlyHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const buyer = await requireActor(ctx as ToolCtx, p, ["buyer"]);
        return svc.getResultForBuyer(buyer, p.task_id);
      }),
  );

  server.tool(
    {
      name: "cancel_task",
      description: "Buyer: cancel an OPEN task and release its payment hold.",
      inputSchema: z.object({ task_id: z.string(), ...apiKeyField }),
      annotations: { destructiveHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const buyer = await requireActor(ctx as ToolCtx, p, ["buyer"]);
        return { task: await svc.cancelTask(buyer, p.task_id) };
      }),
  );

  // ------------------------------------------------------------------ seller
  server.tool(
    {
      name: "register_seller",
      description:
        "Seller: advertise the models your local Ollama actually has (with asking prices). The runner key is optional: omit it when your sandbox generates a fresh key per claim (then every claim_task must carry runner_pubkey_b64). Re-call whenever models change; it replaces the previous registration. Model digests are self-reported, not attested.",
      inputSchema: z.object({
        models: z.array(ModelInfo).min(1),
        ...runnerKeyFields,
        runner_wasm_sha256: z.string().length(64).optional().describe("sha256 of the runner.wasm you loaded."),
        runtime: z.enum(["wassette", "node-unsandboxed"]).describe("node-unsandboxed is a labelled fallback; buyers can see it."),
        wassette_version: z.string().optional(),
        ...apiKeyField,
      }),
      annotations: { idempotentHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        const { api_key: _k, ...input } = p;
        return { seller: await svc.registerSeller(seller, input), next: "list_open_tasks" };
      }),
  );

  server.tool(
    {
      name: "list_open_tasks",
      description: "Seller: OPEN tasks you are eligible for (your model is allowed and your ask fits the buyer's max), oldest first. Metadata only; claim one with claim_task.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(svc.OPEN_TASKS_MAX_LIMIT).optional().describe(`How many OPEN tasks to scan, oldest first; default ${svc.OPEN_TASKS_DEFAULT_LIMIT}.`),
        ...apiKeyField,
      }),
      annotations: { readOnlyHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        return svc.listOpenTasksFor(seller, p.limit);
      }),
  );

  server.tool(
    {
      name: "claim_task",
      description:
        "Seller: atomically claim an OPEN task. First valid claim wins. Pass runner_pubkey_b64 generated inside the sandbox instance that will run the task (required if you registered without a key; overrides the registered key for this claim). Returns claim_id, your locked price, a 300 s lease, seller_envelope (the task encrypted to that key) and the buyer + judge public keys to seal the result to. Decrypt only inside the sandbox.",
      inputSchema: z.object({ task_id: z.string(), model_id: z.string(), ...runnerKeyFields, ...apiKeyField }),
      annotations: { idempotentHint: false },
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        const claim = await svc.claimTask(seller, p.task_id, p.model_id, { runner_pubkey_b64: p.runner_pubkey_b64, runner_key_id: p.runner_key_id });
        return { claim, next: `Decrypt and run inside the sandbox, seal the result to claim.buyer_public_key and claim.judge_public_key, call renew_lease every ~120 s if needed, then submit_result before ${claim.lease_expires_at}.` };
      }),
  );

  server.tool(
    {
      name: "get_recipient_keys",
      description: "Seller: the buyer's and the judge's public keys for your active claim (claim_task already returns them). Seal the identical canonical result bytes to each before submit_result.",
      inputSchema: z.object({ task_id: z.string(), claim_id: z.string(), ...apiKeyField }),
      annotations: { readOnlyHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        return svc.recipientKeys(seller, p.task_id, p.claim_id);
      }),
  );

  server.tool(
    {
      name: "start_task",
      description: "Seller (optional): mark your claimed task RUNNING so buyers see progress.",
      inputSchema: z.object({ task_id: z.string(), claim_id: z.string(), ...apiKeyField }),
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        return { task: await svc.startTask(seller, p.task_id, p.claim_id) };
      }),
  );

  server.tool(
    {
      name: "renew_lease",
      description: "Seller: extend your claim lease by 300 s. Fails with LEASE_EXPIRED if the claim lapsed; stop work then.",
      inputSchema: z.object({ task_id: z.string(), claim_id: z.string(), ...apiKeyField }),
      annotations: { idempotentHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        return svc.renewLease(seller, p.task_id, p.claim_id);
      }),
  );

  server.tool(
    {
      name: "release_task",
      description: "Seller: give up a claim you cannot finish. The task reopens for others; no payout, no strike.",
      inputSchema: z.object({ task_id: z.string(), claim_id: z.string(), reason: z.string().max(200), ...apiKeyField }),
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        return { task: await svc.releaseTask(seller, p.task_id, p.claim_id, p.reason) };
      }),
  );

  server.tool(
    {
      name: "submit_result",
      description:
        "Seller: deliver the result. Both envelopes must contain the same canonical result bytes: one encrypted to claim.buyer_public_key, one to claim.judge_public_key; commitment_sha256 is sha256 of those bytes. Moves the task to SUBMITTED for judging.",
      inputSchema: z.object({
        task_id: z.string(),
        claim_id: z.string(),
        result_enc_buyer: Envelope,
        result_enc_judge: Envelope,
        commitment_sha256: z.string().length(64),
        runtime_ms: z.number().int().nonnegative(),
        tokens_out: z.number().int().nonnegative().optional(),
        ...apiKeyField,
      }),
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        const { api_key: _k, task_id, claim_id, ...input } = p;
        return svc.submitResult(seller, task_id, claim_id, input);
      }),
  );

  // ------------------------------------------------------------------- judge
  server.tool(
    {
      name: "fetch_review_package",
      description: "Judge: atomically take the oldest SUBMITTED task for review. Returns the judge envelopes (task+rubric, result) and the commitment to verify. Null when nothing is waiting.",
      inputSchema: z.object({ ...apiKeyField }),
    },
    async (p, ctx) =>
      run(async () => {
        const judge = await requireActor(ctx as ToolCtx, p, ["judge"]);
        const pkg = await svc.fetchReviewPackage(judge);
        return { package: pkg, judge_key_id: env().JUDGE_KEY_ID };
      }),
  );

  server.tool(
    {
      name: "submit_verdict",
      description:
        "Judge: record APPROVE (captures the buyer's hold for the seller's price and pays the seller) or REJECT (releases the hold, strikes the seller, optionally attaches a replacement answer encrypted to the buyer). If the judge model failed (unavailable, timeout, unreadable grade), send a judge infrastructure reason_code instead: the review is deferred and retried, with no strike and no money moved. Idempotent per task: a repeated call finishes the first recorded decision. The public explanation is chosen by the server from reason_code.",
      inputSchema: z.object({
        task_id: z.string(),
        result_id: z.string(),
        verdict: Verdict,
        reason_code: VerdictReasonCode.describe(`APPROVE: ${APPROVE_REASON_CODES.join(", ")}. REJECT: ${REJECT_REASON_CODES.join(", ")}. Defer (any verdict): ${INFRA_REASON_CODES.join(", ")}.`),
        reason_public: z.string().max(400).optional().describe("Ignored: the server publishes a fixed explanation for reason_code. Accepted so older judges keep working."),
        score: z.number().min(0).max(1).optional(),
        replacement_enc_buyer: Envelope.optional(),
        ...apiKeyField,
      }),
    },
    async (p, ctx) =>
      run(async () => {
        const judge = await requireActor(ctx as ToolCtx, p, ["judge"]);
        const { api_key: _k, ...input } = p;
        return svc.submitVerdict(judge, input);
      }),
  );

  server.tool(
    {
      name: "fetch_replacement_package",
      description:
        "Judge: take the oldest REJECTED task whose buyer has not yet received a judge-produced answer (leased to you for 5 minutes). Returns the judge copy of the task and the buyer's public key; produce the answer, seal it to the buyer and call submit_replacement. Null when nothing is waiting.",
      inputSchema: z.object({ ...apiKeyField }),
    },
    async (p, ctx) =>
      run(async () => {
        const judge = await requireActor(ctx as ToolCtx, p, ["judge"]);
        return { package: await fetchReplacementPackage(judge), judge_key_id: env().JUDGE_KEY_ID };
      }),
  );

  server.tool(
    {
      name: "submit_replacement",
      description:
        "Judge: deliver the replacement answer for a REJECTED task (replacement_enc_buyer sealed to the buyer), or report that the judge model could not produce one (reason_code JUDGE_UNAVAILABLE / JUDGE_TIMEOUT / JUDGE_MALFORMED; retried with backoff, UNAVAILABLE after 5 attempts). Never moves money or changes reputation. Idempotent once delivered.",
      inputSchema: z.object({
        task_id: z.string(),
        result_id: z.string(),
        replacement_enc_buyer: Envelope.optional(),
        reason_code: VerdictReasonCode.optional(),
        ...apiKeyField,
      }),
    },
    async (p, ctx) =>
      run(async () => {
        const judge = await requireActor(ctx as ToolCtx, p, ["judge"]);
        const { api_key: _k, ...input } = p;
        return submitReplacement(judge, input);
      }),
  );
}
