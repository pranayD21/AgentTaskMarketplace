import { z } from "zod";
import {
  SellerPublic,
  JobPublic,
  TaskPublic,
  TASK_STATUSES,
  VERDICT_REASON_CODES,
} from "@atm/shared";

export { TASK_STATUSES };
const eventTypes = [
  "agent.registered",
  "seller.registered",
  "task.posted",
  "task.paid",
  "task.claimed",
  "task.running",
  "task.released",
  "result.submitted",
  "task.judging",
  "verdict.recorded",
  "seller.suspended",
  "task.expired",
  "task.reopened",
  "task.cancelled",
  "result.decrypt_failed",
] as const;

// Parse a strict projection. Never retain event.meta, free-form verdict reasons,
// settlement notes, private task fields, ciphertext, or arbitrary API error bodies.
// Enrollment can precede runner setup. Only the documented no-key sentinel is
// accepted here; advertised registered/per-claim keys keep normal validation.
const DashboardSeller = SellerPublic.extend({
  runner: z.discriminatedUnion("key_source", [
    SellerPublic.shape.runner.extend({key_source: z.enum(["registered", "per-claim"])}),
    SellerPublic.shape.runner.extend({
      key_source: z.literal("none"),
      public_key: z.object({key_id: z.literal("none"), public_key_b64: z.literal("")}).transform(() => null),
    }),
  ]),
});
export const Dashboard = z.object({
  generated_at: z.iso.datetime(),
  payments: z.object({ mode: z.enum(["card", "mpp", "mock"]) }),
  db: z.unknown().transform((value) =>
    typeof value === "string" && value.startsWith("MEMORY")
      ? "memory"
      : value === "Insforge Postgres"
        ? "insforge"
        : "unknown",
  ),
  counts: z.object(
    Object.fromEntries(
      TASK_STATUSES.map((s) => [s, z.number().int().nonnegative().optional()]),
    ),
  ),
  tasks: z.array(TaskPublic.omit({ part_label: true })),
  jobs: z.array(JobPublic.omit({ label_public: true })).default([]),
  sellers: z.array(DashboardSeller),
  verdicts: z.array(
    z.object({
      id: z.string(),
      task_id: z.string(),
      verdict: z.enum(["APPROVE", "REJECT"]),
      reason_code: z.enum(VERDICT_REASON_CODES),
      score: z.number().nullable().optional(),
      created_at: z.string(),
    }),
  ),
  settlements: z.array(
    z
      .object({
        id: z.string(),
        task_id: z.string(),
        kind: z.string().transform((kind) =>
          kind === "STRIPE_TEST" || kind === "MPP" || kind === "MOCK"
            ? kind
            : "UNRECOGNIZED PAYMENT RAIL",
        ),
        state: z.string().transform(v => ["PENDING", "RECORDED"].includes(v) ? v : "UNKNOWN"),
        finalized_at: z.string().nullable().optional(),
        payout_owed_cents: z.number().int().nonnegative().optional(),
        payout_transferred_cents: z.number().int().nonnegative().optional(),
        transfer_state: z.enum(["NOT_APPLICABLE", "PENDING", "TRANSFERRED"]).optional(),
        transfer_retry_at: z.string().nullable().optional(),
        seller_payout_cents: z.number().int().nonnegative(),
        buyer_refund_cents: z.number().int().nonnegative(),
        note: z
          .unknown()
          .transform(
            (v) => typeof v === "string" && v.includes("PENDING_ONBOARDING"),
          ),
        created_at: z.string(),
      })
      .transform(({ note, ...settlement }) => ({
        ...settlement,
        pendingOnboarding: note,
      })),
  ),
  events: z.array(
    z.object({
      id: z
        .union([z.string(), z.number().int().nonnegative()])
        .transform(String),
      task_id: z.string().nullable(),
      created_at: z.string(),
      type: z
        .string()
        .transform((v) =>
          eventTypes.includes(v as (typeof eventTypes)[number])
            ? v
            : "marketplace.event",
        ),
    }),
  ),
});
export type DashboardData = z.infer<typeof Dashboard>;

export function dashboardUrl(base: string): string {
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use an HTTP(S) API origin without credentials, query parameters, or fragments.",
    );
  }
  url.pathname = `${url.pathname.replace(/\/mcp\/?$/, "").replace(/\/$/, "")}/api/dashboard`;
  return url.toString();
}

export const money = (cents: number | null) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);
export const shortId = (id: string | null) =>
  id ? `${id.slice(0, 5)}…${id.slice(-6)}` : "Unclaimed";
export const time = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Unknown time";
export function leaseLabel(
  status: string,
  expires: string | null,
  now: number,
): string {
  if (!["CLAIMED", "PAYLOAD_READY", "RUNNING"].includes(status) || !expires)
    return "—";
  const seconds = Math.ceil((Date.parse(expires) - now) / 1000);
  if (!Number.isFinite(seconds)) return "Unknown";
  if (seconds <= 0) return "Expired · awaiting refresh";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function stripeLink(id: string | null): string | undefined {
  return id && /^pi_[A-Za-z0-9]+$/.test(id)
    ? `https://dashboard.stripe.com/test/payments/${id}`
    : undefined;
}
