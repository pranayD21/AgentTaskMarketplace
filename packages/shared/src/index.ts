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
] as const;
export const VerdictReasonCode = z.enum(VERDICT_REASON_CODES);
export type VerdictReasonCode = z.infer<typeof VerdictReasonCode>;

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
});
export type TaskPublic = z.infer<typeof TaskPublic>;

export const SellerPublic = z.object({
  seller_id: z.string(),
  display_name: z.string(),
  status: SellerStatus,
  models: z.array(ModelInfo),
  runner: z.object({
    public_key: KeyDescriptor,
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
});
export type ClaimPublic = z.infer<typeof ClaimPublic>;

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
