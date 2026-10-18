import Stripe from "stripe";
import { MarketplaceError, type TaskStatus } from "@atm/shared";
import type { AgentRow, TaskRow } from "./db.js";
import { env } from "./env.js";

export type PaymentMode = "card" | "mpp" | "mock";

export interface HoldResult {
  payment_state: "HELD" | "MOCK" | "AWAITING_PAYMENT";
  stripe_payment_intent_id: string | null;
  payment_link: string | null;
  task_status: TaskStatus;
  note: string;
}
export interface CaptureResult {
  payment_state: "CAPTURED" | "MOCK";
  stripe_capture_id: string | null;
  stripe_transfer_id: string | null;
  note: string;
}
export interface ReleaseResult {
  payment_state: "RELEASED" | "MOCK";
  note: string;
}

export interface PaymentProvider {
  readonly mode: PaymentMode;
  /** Human-readable label shown next to every amount. */
  readonly label: string;
  /** Minimum amount the rail accepts, in cents. */
  readonly min_cents: number;
  onboardBuyer(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>>;
  onboardSeller(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>>;
  hold(task: { id: string; max_price_cents: number }, buyer: AgentRow): Promise<HoldResult>;
  capture(task: TaskRow, seller: AgentRow | null, amountCents: number): Promise<CaptureResult>;
  release(task: TaskRow, reason: string): Promise<ReleaseResult>;
}

// ---------------------------------------------------------------------------
// Shared Stripe helpers (test mode only). Used by the card provider below and
// by the MPP provider in mpp.ts, so both rails onboard buyers and pay sellers
// the same way.
// ---------------------------------------------------------------------------

export const STRIPE_APP_INFO = { name: "agent-task-marketplace", version: "0.1.0" };

/** Builds a Stripe client and refuses anything but a test-mode secret key. */
export function createStripe(secretKey: string | undefined): Stripe {
  if (!secretKey || !secretKey.startsWith("sk_test_")) {
    throw new Error("Refusing to start: STRIPE_SECRET_KEY is not a test-mode key (sk_test_...).");
  }
  return new Stripe(secretKey, { appInfo: STRIPE_APP_INFO });
}

/** Buyer: Stripe Customer with the shared test card attached as default. */
export async function onboardBuyerCustomer(stripe: Stripe, agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
  const customer = await stripe.customers.create({
    name: agent.display_name,
    description: `Buyer agent ${agent.id} (Agent Task Marketplace, test mode)`,
    metadata: { agent_id: agent.id, app: "agent-task-marketplace" },
  });
  // Stripe's shared test payment method; attaching clones it onto the customer.
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  return { stripe_customer_id: customer.id, stripe_payment_method_id: pm.id };
}

export type TransfersCapability = "active" | "pending" | "restricted" | "rejected" | "unsupported" | "unknown";

export interface PayoutStatus {
  account_id: string;
  /** `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status` */
  transfers: TransfersCapability;
  /** Requirement entries that still restrict `stripe_balance.stripe_transfers`. */
  blocking: string[];
}

const ACCOUNT_INCLUDE = ["configuration.recipient", "requirements"] as const;

/**
 * Identity that satisfies the `stripe_transfers` requirements of a v2 recipient
 * account in TEST MODE without a hosted onboarding step. The values are
 * Stripe's documented test-mode verification values (DOB 1901-01-01, SSN last 4
 * 0000, address line "address_full_match"); they verify instantly in the
 * sandbox and would be rejected in live mode. A real deployment collects the
 * seller's own details through the hosted Account Link (see onboardingLink)
 * and keeps the terms-of-service attestation from the seller's actual request.
 */
function testModeRecipientIdentity(agent: { id: string; display_name: string }): Stripe.V2.Core.AccountCreateParams.Identity {
  return {
    country: "us",
    entity_type: "individual",
    individual: {
      given_name: "Test",
      surname: `Seller ${agent.id.slice(-6)}`,
      email: `${agent.id}@agenttaskmarket.dev`,
      phone: "+18885551234",
      date_of_birth: { day: 1, month: 1, year: 1901 },
      address: { country: "us", line1: "address_full_match", city: "San Francisco", state: "CA", postal_code: "94103" },
      id_numbers: [{ type: "us_ssn_last_4", value: "0000" }],
      metadata: { agent_id: agent.id, synthetic_identity: "stripe-test-mode-values" },
    },
    attestations: {
      terms_of_service: {
        account: { date: new Date().toISOString(), ip: "127.0.0.1", user_agent: "agent-task-marketplace/0.1.0 (test-mode seller onboarding)" },
      },
    },
  };
}

function recipientProfile(agent: { display_name: string }): Stripe.V2.Core.AccountCreateParams.Defaults.Profile {
  return {
    business_url: "https://agenttaskmarket.dev",
    product_description: `Seller agent "${agent.display_name}" rents idle local compute on the Agent Task Marketplace (test mode).`,
  };
}

function readPayoutStatus(account: Stripe.V2.Core.Account): PayoutStatus {
  const cap = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers;
  const blocking = (account.requirements?.entries ?? [])
    .filter((e) => (e.impact?.restricts_capabilities ?? []).some((r) => r.capability === "stripe_balance.stripe_transfers"))
    .map((e) => e.description);
  return { account_id: account.id, transfers: (cap?.status as TransfersCapability | undefined) ?? "unknown", blocking };
}

/** Read the current transfers capability of a v2 recipient account. */
export async function payoutStatus(stripe: Stripe, accountId: string): Promise<PayoutStatus> {
  const account = await stripe.v2.core.accounts.retrieve(accountId, { include: [...ACCOUNT_INCLUDE] });
  return readPayoutStatus(account);
}

/**
 * Seller: v2 recipient account that can receive platform transfers.
 * Stripe refuses new Accounts v1 (type=custom) integrations, so this uses
 * /v2/core/accounts with the recipient configuration and requests the
 * `stripe_transfers` capability. With the test-mode identity above the
 * capability is active on creation (verified 2026-10-18 01:50 UTC).
 */
export async function createRecipientAccount(stripe: Stripe, agent: { id: string; display_name: string }): Promise<PayoutStatus> {
  const account = await stripe.v2.core.accounts.create({
    display_name: agent.display_name,
    contact_email: `${agent.id}@agenttaskmarket.dev`,
    dashboard: "none",
    defaults: {
      currency: "usd",
      responsibilities: { fees_collector: "application", losses_collector: "application" },
      profile: recipientProfile(agent),
    },
    identity: testModeRecipientIdentity(agent),
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    metadata: { agent_id: agent.id, app: "agent-task-marketplace" },
    include: [...ACCOUNT_INCLUDE],
  });
  return readPayoutStatus(account);
}

/**
 * Make sure `stripe_transfers` is active on an existing account: accounts
 * created before identity onboarding existed are updated in place with the
 * test-mode identity, then the capability is polled (bounded).
 */
export async function ensureTransfersActive(
  stripe: Stripe,
  accountId: string,
  agent: { id: string; display_name: string },
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<PayoutStatus> {
  const attempts = opts.attempts ?? 5;
  const delayMs = opts.delayMs ?? 1000;
  let status = await payoutStatus(stripe, accountId);
  if (status.transfers === "active") return status;
  if (status.transfers === "restricted" || status.transfers === "unknown" || status.blocking.length) {
    try {
      const updated = await stripe.v2.core.accounts.update(accountId, {
        defaults: { profile: recipientProfile(agent) },
        identity: testModeRecipientIdentity(agent),
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
        include: [...ACCOUNT_INCLUDE],
      });
      status = readPayoutStatus(updated);
    } catch (err) {
      console.warn(`[stripe] could not complete onboarding for ${accountId}: ${(err as Error).message}`);
    }
  }
  for (let i = 0; status.transfers !== "active" && i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    status = await payoutStatus(stripe, accountId);
  }
  return status;
}

/** Hosted Connect onboarding for a real seller (not used in the demo; documented in docs/payments). */
export async function onboardingLink(stripe: Stripe, accountId: string, baseUrl: string): Promise<string> {
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: { type: "account_onboarding", account_onboarding: { refresh_url: `${baseUrl}/api/dashboard`, return_url: `${baseUrl}/api/dashboard` } },
  });
  return link.url;
}

/**
 * Move the captured amount to the seller's connected account. `source_transaction`
 * ties the transfer to the buyer's charge so it does not need a platform balance.
 * Returns a labelled note instead of throwing so settlement always records.
 */
export async function transferToSeller(
  stripe: Stripe,
  task: { id: string },
  seller: AgentRow | null,
  amountCents: number,
  chargeId: string | null,
): Promise<{ transfer_id: string | null; note: string }> {
  if (!seller?.stripe_account_id) return { transfer_id: null, note: "seller has no connected account (payout PENDING_ONBOARDING)" };
  const status = await ensureTransfersActive(stripe, seller.stripe_account_id, seller);
  if (status.transfers !== "active") {
    return { transfer_id: null, note: `transfer PENDING_ONBOARDING: ${seller.stripe_account_id} stripe_transfers=${status.transfers} (${status.blocking.join(", ") || "no details"})` };
  }
  try {
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination: seller.stripe_account_id,
      transfer_group: task.id,
      ...(chargeId ? { source_transaction: chargeId } : {}),
      metadata: { task_id: task.id, seller_id: seller.id, app: "agent-task-marketplace" },
    });
    return { transfer_id: transfer.id, note: `transferred ${amountCents}c to ${seller.stripe_account_id} (${transfer.id})` };
  } catch (err) {
    return { transfer_id: null, note: `transfer PENDING_ONBOARDING: ${(err as Error).message}` };
  }
}

/** Shared seller onboarding used by both Stripe providers. Never throws. */
export async function onboardSellerAccount(stripe: Stripe, agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
  try {
    const status = await createRecipientAccount(stripe, agent);
    if (status.transfers !== "active") {
      console.warn(`[stripe] ${status.account_id}: stripe_transfers=${status.transfers}; blocking: ${status.blocking.join(", ") || "none"}`);
    }
    return { stripe_account_id: status.account_id };
  } catch (err) {
    console.warn(`[stripe] connected account for ${agent.id} not created: ${(err as Error).message}`);
    return { stripe_account_id: null };
  }
}

// ---------------------------------------------------------------------------
// Mock: no money moves. Every surface that shows it says so.
// ---------------------------------------------------------------------------

class MockProvider implements PaymentProvider {
  readonly mode = "mock" as const;
  readonly label = "MOCK — no payment rail connected";
  readonly min_cents = 1;
  async onboardBuyer() { return {}; }
  async onboardSeller() { return {}; }
  async hold(): Promise<HoldResult> {
    return { payment_state: "MOCK", stripe_payment_intent_id: null, payment_link: null, task_status: "OPEN", note: "mock hold (no payment rail)" };
  }
  async capture(_task: TaskRow, _seller: AgentRow | null, amountCents: number): Promise<CaptureResult> {
    return { payment_state: "MOCK", stripe_capture_id: null, stripe_transfer_id: null, note: `mock payout of ${amountCents}c (no payment rail)` };
  }
  async release(): Promise<ReleaseResult> {
    return { payment_state: "MOCK", note: "mock release (no payment rail)" };
  }
}

// ---------------------------------------------------------------------------
// Stripe test mode, "card" flow: manual-capture hold at post_task, capture of
// the claim price on APPROVE (remainder auto-released), cancel on REJECT or
// expiry, Connect transfer of the captured amount to the seller.
// ---------------------------------------------------------------------------

class StripeCardProvider implements PaymentProvider {
  readonly mode = "card" as const;
  readonly label = "Stripe TEST MODE — manual-capture hold on the buyer's saved test card";
  readonly min_cents = 50; // Stripe minimum charge for USD
  private readonly stripe: Stripe;

  constructor(secretKey: string | undefined) {
    this.stripe = createStripe(secretKey);
  }

  onboardBuyer(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
    return onboardBuyerCustomer(this.stripe, agent);
  }

  onboardSeller(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
    return onboardSellerAccount(this.stripe, agent);
  }

  async hold(task: { id: string; max_price_cents: number }, buyer: AgentRow): Promise<HoldResult> {
    if (!buyer.stripe_customer_id || !buyer.stripe_payment_method_id) {
      throw new MarketplaceError("PAYMENT_FAILED", "Buyer has no payment method on file.", {
        next_action: "Re-register the buyer agent so a test card is attached.",
      });
    }
    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.stripe.paymentIntents.create({
        amount: task.max_price_cents,
        currency: "usd",
        customer: buyer.stripe_customer_id,
        payment_method: buyer.stripe_payment_method_id,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        confirm: true,
        off_session: true,
        capture_method: "manual",
        transfer_group: task.id,
        description: `Agent Task Marketplace hold for ${task.id} (TEST MODE)`,
        metadata: { task_id: task.id, buyer_id: buyer.id, app: "agent-task-marketplace" },
      });
    } catch (err) {
      throw new MarketplaceError("PAYMENT_FAILED", `Stripe refused the hold: ${(err as Error).message}`);
    }
    if (pi.status !== "requires_capture") {
      throw new MarketplaceError("PAYMENT_FAILED", `Unexpected PaymentIntent status ${pi.status}; expected requires_capture.`);
    }
    return {
      payment_state: "HELD",
      stripe_payment_intent_id: pi.id,
      payment_link: null,
      task_status: "OPEN",
      note: `Stripe test-mode hold ${pi.id} for ${task.max_price_cents}c`,
    };
  }

  async capture(task: TaskRow, seller: AgentRow | null, amountCents: number): Promise<CaptureResult> {
    if (!task.stripe_payment_intent_id) {
      return { payment_state: "CAPTURED", stripe_capture_id: null, stripe_transfer_id: null, note: "no PaymentIntent on task; nothing captured" };
    }
    const pi = await this.stripe.paymentIntents.capture(task.stripe_payment_intent_id, { amount_to_capture: amountCents });
    const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    const transfer = await transferToSeller(this.stripe, task, seller, amountCents, chargeId);
    const note = `captured ${amountCents}c of the ${task.max_price_cents}c hold (${pi.id}); remainder released; ${transfer.note}`;
    return { payment_state: "CAPTURED", stripe_capture_id: chargeId, stripe_transfer_id: transfer.transfer_id, note };
  }

  async release(task: TaskRow, reason: string): Promise<ReleaseResult> {
    if (!task.stripe_payment_intent_id) return { payment_state: "RELEASED", note: "no PaymentIntent on task" };
    try {
      const pi = await this.stripe.paymentIntents.cancel(task.stripe_payment_intent_id, { cancellation_reason: "requested_by_customer" });
      return { payment_state: "RELEASED", note: `hold ${pi.id} cancelled (${reason})` };
    } catch (err) {
      return { payment_state: "RELEASED", note: `hold cancel attempted (${reason}): ${(err as Error).message}` };
    }
  }
}

let provider: PaymentProvider | undefined;

export function payments(): PaymentProvider {
  if (provider) return provider;
  const e = env();
  switch (e.PAYMENT_MODE) {
    case "mock":
      provider = new MockProvider();
      break;
    case "card":
      provider = new StripeCardProvider(e.STRIPE_SECRET_KEY);
      break;
    case "mpp":
      throw new Error("PAYMENT_MODE=mpp is not wired yet; use card or mock");
  }
  console.log(`[payments] mode=${provider.mode}: ${provider.label}`);
  return provider;
}
