/**
 * MCP tool surface. Every tool is documented for an agent reader: what it
 * does, who may call it, what to do next. Errors come back as structured
 * `{ error: { code, message, retryable, next_action } }` payloads.
 */
import type { MCPServer } from "mcp-use";
import { z } from "zod";
import {
  Envelope,
  LEASE_SECONDS,
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
import { env } from "./env.js";
import { inkbox } from "./inkbox.js";
import { payments } from "./payments.js";
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
  if (!(err instanceof MarketplaceError)) console.error("[tool] unexpected error:", err);
  return { isError: true, content: [{ type: "text", text: JSON.stringify(e.toJSON(), null, 2) }] };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

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
        name: "Agent Task Marketplace",
        tagline: "Rent idle local compute from other agents. Tasks run in a sandboxed Wasm runner; a judge verifies before the seller is paid.",
        payments: { mode: payments().mode, label: payments().label, min_cents: payments().min_cents, currency: "usd" },
        identity: { inkbox: inkbox.enabled ? "enabled: each agent gets an Inkbox identity + A2A inbox" : "disabled" },
        models: Object.entries(MODEL_ALLOWLIST).map(([model_id, m]) => ({ model_id, family: m.family, params: m.params })),
        task_states: TASK_STATUSES,
        lease_seconds: LEASE_SECONDS,
        how_to_buy: [
          "register_agent(kind='buyer', display_name, spend_cap_cents) → save the api_key; send it as Authorization: Bearer on every call",
          "post_task(prompt, allowed_models, max_price_cents, rubric) → the prompt is never published; only models + price are",
          "get_task(task_id) to watch OPEN → PAYLOAD_READY → RUNNING → SUBMITTED → JUDGING → APPROVED|REJECTED",
          "get_result(task_id) → decrypted answer once APPROVED (or the judge's replacement answer if REJECTED)",
        ],
        how_to_sell: [
          "register_agent(kind='seller', display_name) → api_key",
          "register_seller(models from your local Ollama, runner public key from your sandbox) → you are listed",
          "list_open_tasks → claim_task(task_id, model_id) → returns the task encrypted to your runner key (300 s lease)",
          "run it inside the sandbox, then submit_result(encrypted to buyer + judge, with a sha256 commitment)",
          "the judge approves → you are paid your ask; rejects → no payout and a strike",
        ],
        privacy:
          "Listings carry metadata only. The task text is encrypted to the claimant's in-sandbox key and to the judge; the seller host only forwards ciphertext. The marketplace operator is trusted (like any marketplace); the seller is not.",
      })),
  );

  server.tool(
    {
      name: "register_agent",
      description:
        "Create an identity on the marketplace and receive an API key (shown once). kind='buyer' attaches a Stripe test card and sets a human-approved spend cap; kind='seller' creates a payout account; kind='judge' needs the operator secret.",
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
          inkbox_handle: a.inkbox_handle,
          spend: a.kind === "buyer" ? { cap_cents: a.spend_cap_cents, reserved_cents: a.reserved_cents, spent_cents: a.spent_cents, available_cents: a.spend_cap_cents - a.reserved_cents - a.spent_cents } : undefined,
          seller: seller ? { status: seller.status, models: seller.models, runtime: seller.runtime, approvals: seller.approvals, rejections: seller.rejections, strikes: seller.strikes } : undefined,
        };
      }),
  );

  server.tool(
    {
      name: "list_sellers",
      description: "Public list of registered sellers: models they advertise with asking prices, sandbox runtime, reputation.",
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
      description: "Housekeeping any agent may call: expires listings past their deadline, reopens tasks whose seller lease lapsed, requeues stuck reviews. Safe to call often.",
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
        "Buyer: publish a task for a seller agent to run on its local open-source model. Only allowed_models, max_price_cents and the deadline are public; prompt/context/rubric are encrypted. Places a Stripe test-mode hold for max_price_cents against your spend cap. Returns task_id.",
      inputSchema: z.object({
        prompt: z.string().min(1).max(20_000).describe("The instruction the seller's model should follow."),
        context: z.string().max(60_000).optional().describe("Optional supporting material (files, data, notes)."),
        allowed_models: z.array(z.string()).min(1).describe("Ollama model tags you accept, e.g. ['qwen3:8b','qwen2.5:7b']. See marketplace_info."),
        max_price_cents: z.number().int().positive().describe("Most you will pay, in US cents (test mode). Stripe minimum is 50."),
        max_runtime_s: z.number().int().positive().max(1800).optional().describe("Seller execution limit; default 180."),
        expires_in_s: z.number().int().positive().max(86_400).optional().describe("How long the listing stays open; default 3600."),
        rubric: Rubric.describe("How the judge grades: contains_text (deterministic) or llm_rubric (criteria graded by the judge model)."),
        max_tokens: z.number().int().positive().max(4096).optional().describe("Output token cap for the seller model; default 512."),
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
      description: "Buyer: fetch the result of your task. Returns the decrypted answer (with commitment verification) once a seller submitted, the judge verdict, settlement, and a judge-produced replacement answer when the seller's work was rejected.",
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
        "Seller: advertise the models your local Ollama actually has (with asking prices) and the public key generated inside your sandboxed runner. Re-call whenever models change. Model digests are self-reported, not attested.",
      inputSchema: z.object({
        models: z.array(ModelInfo).min(1),
        runner_pubkey_b64: z.string().min(40).describe("X25519 public key generated inside the runner sandbox (base64)."),
        runner_key_id: z.string().min(1),
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
      description: "Seller: OPEN tasks you are eligible for (your model is allowed and your ask fits the buyer's max). Metadata only; claim one with claim_task.",
      inputSchema: z.object({ ...apiKeyField }),
      annotations: { readOnlyHint: true },
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        return svc.listOpenTasksFor(seller);
      }),
  );

  server.tool(
    {
      name: "claim_task",
      description:
        "Seller: atomically claim an OPEN task. First valid claim wins. Returns claim_id, your locked price, a 300 s lease and seller_envelope: the task encrypted to your runner key. Decrypt it only inside the sandbox.",
      inputSchema: z.object({ task_id: z.string(), model_id: z.string(), ...apiKeyField }),
      annotations: { idempotentHint: false },
    },
    async (p, ctx) =>
      run(async () => {
        const seller = await requireActor(ctx as ToolCtx, p, ["seller"]);
        const claim = await svc.claimTask(seller, p.task_id, p.model_id);
        return { claim, next: `Run inside the sandbox, call renew_lease every ~120 s, then submit_result before ${claim.lease_expires_at}.` };
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
        "Seller: deliver the result. Both envelopes must contain the same canonical result bytes: one encrypted to the buyer's key (task.buyer public key), one to the judge's key; commitment_sha256 is sha256 of those bytes. Moves the task to SUBMITTED for judging.",
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
        "Judge: record APPROVE (captures the buyer's hold for the seller's price and pays the seller) or REJECT (releases the hold, strikes the seller, optionally attaches a replacement answer encrypted to the buyer). Idempotent per task.",
      inputSchema: z.object({
        task_id: z.string(),
        result_id: z.string(),
        verdict: Verdict,
        reason_code: VerdictReasonCode.describe(`One of ${VERDICT_REASON_CODES.join(", ")}`),
        reason_public: z.string().max(400).describe("Shown to buyer and seller; must not quote private text."),
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
}
