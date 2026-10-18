import { z } from "zod";

// ---------------------------------------------------------------------------
// Task lifecycle
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  "AWAITING_PAYMENT",
  "OPEN",
  "CLAIMED",
  "PAYLOAD_READY",
  "RUNNING",
  "SUBMITTED",
  "JUDGING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** States in which a seller holds a live claim on the task. */
export const ACTIVE_CLAIM_STATUSES: readonly TaskStatus[] = ["CLAIMED", "PAYLOAD_READY", "RUNNING"];
/** Terminal states. */
export const TERMINAL_STATUSES: readonly TaskStatus[] = ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED"];

export const LEASE_SECONDS = 300;
export const DEFAULT_MAX_RUNTIME_SECONDS = 180;
export const DEFAULT_LISTING_TTL_SECONDS = 60 * 60;
/** Upper bound on a task's max_price_cents (US cents, test mode). */
export const MAX_PRICE_CENTS = 100_000;
/** Version of docs/CONTRACT.md this package implements. */
export const CONTRACT_VERSION = "0.2" as const;

export const AgentKind = z.enum(["buyer", "seller", "judge"]);
export type AgentKind = z.infer<typeof AgentKind>;

export const SellerStatus = z.enum(["ACTIVE", "SUSPENDED"]);
export type SellerStatus = z.infer<typeof SellerStatus>;

// ---------------------------------------------------------------------------
// Keys and envelopes (see packages/crypto for the implementation)
// ---------------------------------------------------------------------------

export const ENVELOPE_ALG = "x25519-hkdf-xchacha20poly1305-v1" as const;

export const KeyDescriptor = z.object({
  key_id: z.string().min(1),
  public_key_b64: z.string().min(40),
});
export type KeyDescriptor = z.infer<typeof KeyDescriptor>;

export const Envelope = z.object({
  alg: z.literal(ENVELOPE_ALG),
  recipient_key_id: z.string().min(1),
  epk_b64: z.string().min(40),
  nonce_b64: z.string().min(30),
  ct_b64: z.string().min(1),
});
export type Envelope = z.infer<typeof Envelope>;

// ---------------------------------------------------------------------------
// Rubrics and private payloads
// ---------------------------------------------------------------------------

export const Rubric = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contains_text"),
    expected_text: z.string().min(1).describe("Case-insensitive substring the answer must contain"),
  }),
  z.object({
    kind: z.literal("llm_rubric"),
    criteria: z.string().min(1).describe("Natural-language grading criteria applied by the judge model"),
  }),
]);
export type Rubric = z.infer<typeof Rubric>;

/** What the seller runner decrypts. Never includes the rubric. */
export const SellerPayload = z.object({
  task_id: z.string(),
  claim_id: z.string(),
  prompt: z.string().min(1),
  context: z.string().optional(),
  max_tokens: z.number().int().positive().max(4096).default(512),
});
export type SellerPayload = z.infer<typeof SellerPayload>;

/** What the judge runner decrypts. */
export const JudgePayload = z.object({
  task_id: z.string(),
  prompt: z.string().min(1),
  context: z.string().optional(),
  rubric: Rubric,
});
export type JudgePayload = z.infer<typeof JudgePayload>;

/** Result plaintext; identical bytes are encrypted separately for buyer and judge. */
export const ResultPlaintext = z.object({
  answer: z.string(),
  task_id: z.string(),
  claim_id: z.string(),
  model_id: z.string(),
  salt_b64: z.string().min(40),
});
export type ResultPlaintext = z.infer<typeof ResultPlaintext>;

/** Output of the runner's run-task export. */
export const RunTaskOutput = z.object({
  result_enc_buyer: Envelope,
  result_enc_judge: Envelope,
  commitment_sha256: z.string().length(64),
  runtime_ms: z.number().int().nonnegative(),
  model_id: z.string(),
  tokens_out: z.number().int().nonnegative().optional(),
});
export type RunTaskOutput = z.infer<typeof RunTaskOutput>;

export const Verdict = z.enum(["APPROVE", "REJECT"]);
export type Verdict = z.infer<typeof Verdict>;

export const VERDICT_REASON_CODES = [
  "RUBRIC_MATCH",
  "RUBRIC_MISMATCH",
  "COMMITMENT_MISMATCH",
  "EMPTY_ANSWER",
  "LLM_RUBRIC_PASS",
  "LLM_RUBRIC_FAIL",
  "JUDGE_ERROR",
  "JUDGE_UNAVAILABLE",
  "JUDGE_TIMEOUT",
  "JUDGE_MALFORMED",
] as const;
export const VerdictReasonCode = z.enum(VERDICT_REASON_CODES);
export type VerdictReasonCode = z.infer<typeof VerdictReasonCode>;

/** Quality codes that may accompany APPROVE / REJECT (contract §8.2). */
export const APPROVE_REASON_CODES: readonly VerdictReasonCode[] = ["RUBRIC_MATCH", "LLM_RUBRIC_PASS"];
export const REJECT_REASON_CODES: readonly VerdictReasonCode[] = ["RUBRIC_MISMATCH", "LLM_RUBRIC_FAIL", "COMMITMENT_MISMATCH", "EMPTY_ANSWER"];
/** Judge infrastructure failures: a retry, never a verdict, never a strike. */
export const INFRA_REASON_CODES: readonly VerdictReasonCode[] = ["JUDGE_ERROR", "JUDGE_UNAVAILABLE", "JUDGE_TIMEOUT", "JUDGE_MALFORMED"];
export function isInfraReason(code: string): boolean {
  return (INFRA_REASON_CODES as readonly string[]).includes(code);
}

/**
 * The only public explanation of a verdict (contract §8.1). The server picks
 * it from the reason code; judge-written text is never published.
 */
export const PUBLIC_REASON: Record<VerdictReasonCode, string> = {
  RUBRIC_MATCH: "The answer contained the buyer's expected text.",
  RUBRIC_MISMATCH: "The answer did not contain the buyer's expected text.",
  COMMITMENT_MISMATCH: "The delivered result did not match the seller's commitment.",
  EMPTY_ANSWER: "The seller returned an empty answer.",
  LLM_RUBRIC_PASS: "The judge model found that the answer meets the buyer's criteria.",
  LLM_RUBRIC_FAIL: "The judge model found that the answer does not meet the buyer's criteria.",
  JUDGE_ERROR: "The judge could not complete the review; it will be retried.",
  JUDGE_UNAVAILABLE: "The judge model was unavailable; the review will be retried.",
  JUDGE_TIMEOUT: "The judge timed out; the review will be retried.",
  JUDGE_MALFORMED: "The judge returned an unreadable grade; the review will be retried.",
};

export function publicReason(code: string): string {
  return (PUBLIC_REASON as Record<string, string>)[code] ?? "Reviewed by the judge.";
}

export const REVIEW_STATUSES = ["NOT_SUBMITTED", "PENDING", "RETRY_PENDING", "JUDGE_UNAVAILABLE", "FINAL"] as const;
export const ReviewStatus = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const REPLACEMENT_STATUSES = ["NOT_NEEDED", "PENDING", "DELIVERED", "UNAVAILABLE"] as const;
export const ReplacementStatus = z.enum(REPLACEMENT_STATUSES);
export type ReplacementStatus = z.infer<typeof ReplacementStatus>;

/** Deferred reviews: 30 s doubling to 10 min; JUDGE_UNAVAILABLE after this many. */
export const MAX_REVIEW_ATTEMPTS = 6;
export const MAX_REPLACEMENT_ATTEMPTS = 5;
export function retryDelaySeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 600);
}

/** Output of the runner's judge-task export. */
export const JudgeTaskOutput = z.object({
  verdict: Verdict,
  reason_code: VerdictReasonCode,
  reason_public: z.string().max(400).describe("Safe to show publicly; must not quote private text"),
  score: z.number().min(0).max(1).optional(),
  replacement_enc_buyer: Envelope.optional().describe("Judge-produced answer for the buyer when the seller's result was rejected"),
});
export type JudgeTaskOutput = z.infer<typeof JudgeTaskOutput>;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export const ModelInfo = z.object({
  model_id: z.string().min(1).describe("Exact Ollama model tag, e.g. qwen3:8b"),
  digest: z.string().optional().describe("Self-reported Ollama digest (not attestation)"),
  ask_cents: z.number().int().nonnegative().describe("Price the seller asks per task, in US cents (test mode)"),
  tok_per_s: z.number().nonnegative().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

/**
 * Open-source models sellers may advertise. Digest pins are filled in once a
 * reference pull is recorded; until then the marketplace matches on model_id.
 */
export const MODEL_ALLOWLIST: Record<string, { family: string; params: string; digest?: string }> = {
  "qwen3:8b": { family: "qwen3", params: "8B" },
  "qwen3:4b": { family: "qwen3", params: "4B" },
  "qwen3:14b": { family: "qwen3", params: "14B" },
  "qwen2.5:7b": { family: "qwen2.5", params: "7B" },
  "qwen2.5-coder:7b": { family: "qwen2.5-coder", params: "7B" },
  "llama3.1:8b": { family: "llama3.1", params: "8B" },
  "gemma3:4b": { family: "gemma3", params: "4B" },
  "gemma3:12b": { family: "gemma3", params: "12B" },
  "deepseek-r1:8b": { family: "deepseek-r1", params: "8B" },
  "mistral:7b": { family: "mistral", params: "7B" },
};

export function isAllowlistedModel(modelId: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_ALLOWLIST, modelId);
}

// ---------------------------------------------------------------------------
// Public records (what the API returns; never contains plaintext)
// ---------------------------------------------------------------------------

export const TaskPublic = z.object({
  task_id: z.string(),
  buyer_id: z.string(),
  allowed_models: z.array(z.string()).min(1),
  max_price_cents: z.number().int().positive(),
  max_runtime_s: z.number().int().positive(),
  status: TaskStatus,
  created_at: z.string(),
  expires_at: z.string(),
  claim_id: z.string().nullable(),
  seller_id: z.string().nullable(),
  model_id: z.string().nullable(),
  price_cents: z.number().int().nullable(),
  lease_expires_at: z.string().nullable(),
  payment: z.object({
    mode: z.enum(["card", "mpp", "mock"]),
    state: z.string(),
    stripe_payment_intent_id: z.string().nullable(),
    payment_link: z.string().nullable(),
  }),
  inkbox_context_id: z.string().nullable(),
  // v0.3 (contract §8, §10). Optional so clients still parse a v0.2 server.
  review: z.object({ status: ReviewStatus, attempts: z.number().int(), retry_at: z.string().nullable() }).optional(),
  replacement_status: ReplacementStatus.nullable().optional(),
  job_id: z.string().nullable().optional(),
  part_key: z.string().nullable().optional(),
  part_label: z.string().nullable().optional(),
  attempt: z.number().int().nullable().optional(),
});
export type TaskPublic = z.infer<typeof TaskPublic>;

// ---------------------------------------------------------------------------
// Jobs: a buyer request split into parts (contract §10)
// ---------------------------------------------------------------------------

export const JOB_STATUSES = ["EMPTY", "IN_PROGRESS", "COMPLETE", "PARTIAL_FAILURE"] as const;
export const JobStatus = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatus>;

export const PART_KEY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export const JobProgress = z.object({
  parts: z.number().int(),
  approved: z.number().int(),
  rejected: z.number().int(),
  in_progress: z.number().int(),
  open: z.number().int(),
  failed_latest: z.number().int(),
});
export type JobProgress = z.infer<typeof JobProgress>;

export const JobPublic = z.object({
  job_id: z.string(),
  buyer_id: z.string(),
  label_public: z.string().nullable(),
  budget_cents: z.number().int(),
  reserved_cents: z.number().int(),
  spent_cents: z.number().int(),
  status: JobStatus,
  created_at: z.string(),
  progress: JobProgress,
});
export type JobPublic = z.infer<typeof JobPublic>;

// ---------------------------------------------------------------------------
// Benchmark usage records (contract §11). Unmeasured quantities are null, never 0.
// ---------------------------------------------------------------------------

export const UsageRecord = z.object({
  schema: z.literal("atm.usage.v1"),
  run_id: z.string().min(1),
  case_id: z.string().min(1),
  arm: z.enum(["local", "marketplace", "baseline"]),
  component: z.enum(["buyer", "seller", "judge", "replacement", "hosting", "payment"]),
  task_id: z.string().nullable().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  model_version: z.string().nullable().optional(),
  started_at: z.string(),
  ended_at: z.string(),
  latency_ms: z.number().nonnegative(),
  load_ms: z.number().nonnegative().nullable().optional(),
  input_tokens: z.number().int().nonnegative().nullable().optional(),
  output_tokens: z.number().int().nonnegative().nullable().optional(),
  cache_read_tokens: z.number().int().nonnegative().nullable().optional(),
  cache_write_tokens: z.number().int().nonnegative().nullable().optional(),
  retries: z.number().int().nonnegative(),
  success: z.boolean(),
  energy_wh: z.number().nonnegative().nullable().optional(),
  energy_basis: z.enum(["measured", "estimated"]).nullable().optional(),
  hardware: z.string().nullable().optional(),
  cost_usd: z.number().nonnegative().nullable().optional(),
  cost_basis: z.enum(["invoice", "list_price", "estimate"]).nullable().optional(),
  price_source: z.string().nullable().optional(),
  price_date: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type UsageRecord = z.infer<typeof UsageRecord>;

/**
 * Where a claim's seller envelope key came from: a key presented with this
 * claim_task call (generated inside that sandbox instance), or the key stored
 * by register_seller.
 */
export const RunnerKeySource = z.enum(["per-claim", "registered"]);
export type RunnerKeySource = z.infer<typeof RunnerKeySource>;

export const SellerPublic = z.object({
  seller_id: z.string(),
  display_name: z.string(),
  status: SellerStatus,
  models: z.array(ModelInfo),
  runner: z.object({
    /** Registered key, else the key of the seller's latest per-claim key, else key_id "none" with an empty key. */
    public_key: KeyDescriptor,
    key_source: z.enum(["registered", "per-claim", "none"]),
    wasm_sha256: z.string().nullable(),
    runtime: z.enum(["wassette", "node-unsandboxed"]),
    wassette_version: z.string().nullable(),
  }),
  reputation: z.object({
    approvals: z.number().int(),
    rejections: z.number().int(),
    strikes: z.number().int(),
  }),
  inkbox_handle: z.string().nullable(),
  last_seen: z.string(),
});
export type SellerPublic = z.infer<typeof SellerPublic>;

export const ClaimPublic = z.object({
  claim_id: z.string(),
  task_id: z.string(),
  seller_id: z.string(),
  model_id: z.string(),
  price_cents: z.number().int(),
  lease_expires_at: z.string(),
  seller_envelope: Envelope,
  max_runtime_s: z.number().int(),
  // v0.2 fields. A v0.2 server always sends them; they are optional here only
  // so clients built from this package still parse a v0.1 server's claims.
  /** Key the seller envelope is sealed to. */
  runner_key_id: z.string().optional(),
  runner_key_source: RunnerKeySource.optional(),
  /** Seal the result to these two keys (same values as get_recipient_keys). */
  buyer_public_key: KeyDescriptor.optional(),
  judge_public_key: KeyDescriptor.optional(),
});
export type ClaimPublic = z.infer<typeof ClaimPublic>;
/** What a v0.2 server returns from claim_task. */
export type ClaimPublicV02 = ClaimPublic & Required<Pick<ClaimPublic, "runner_key_id" | "runner_key_source" | "buyer_public_key" | "judge_public_key">>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SPEND_CAP_EXCEEDED: 409,
  PAYMENT_REQUIRED: 402,
  PAYMENT_FAILED: 402,
  CLAIM_CONFLICT: 409,
  MODEL_NOT_ALLOWED: 409,
  INVALID_STATE: 409,
  JOB_BUDGET_EXCEEDED: 409,
  LEASE_EXPIRED: 410,
  SELLER_SUSPENDED: 403,
  INTERNAL_ERROR: 500,
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export class MarketplaceError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly next_action?: string;
  constructor(code: ErrorCode, message: string, opts: { retryable?: boolean; next_action?: string } = {}) {
    super(message);
    this.name = "MarketplaceError";
    this.code = code;
    this.status = ERROR_CODES[code];
    this.retryable = opts.retryable ?? false;
    this.next_action = opts.next_action;
  }
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.next_action ? { next_action: this.next_action } : {}),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Small helpers shared by server and daemon
// ---------------------------------------------------------------------------

export function nowIso(): string {
  return new Date().toISOString();
}

export function plusSecondsIso(seconds: number, from: Date = new Date()): string {
  return new Date(from.getTime() + seconds * 1000).toISOString();
}

export function isPast(iso: string | null | undefined): boolean {
  return !!iso && Date.parse(iso) <= Date.now();
}
