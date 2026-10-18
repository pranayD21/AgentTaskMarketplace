import Stripe from "stripe";
import { MarketplaceError, type TaskStatus } from "@atm/shared";
import type { AgentRow, TaskRow } from "./db.js";
import { env } from "./env.js";
import { StripeMppProvider } from "./mpp.js";

export type PaymentMode = "card" | "mpp" | "mock";

export interface HoldResult {
  payment_state: "HELD" | "MOCK" | "AWAITING_PAYMENT";
  stripe_payment_intent_id: string | null;
  payment_link: string | null;
  task_status: TaskStatus;
  note: string;
}
/** Where the seller's money is after a capture or a retry (matches settlements.transfer_state, CONTRACT §9). */
export type TransferState = "TRANSFERRED" | "PENDING" | "NOT_APPLICABLE";
/** Why a transfer is still PENDING. MISMATCH needs an operator: a transfer exists but is not the one this task owes. */
export type PendingReason = "PENDING_ONBOARDING" | "PROVIDER_ERROR" | "LOOKUP_ERROR" | "MISMATCH";
export interface TransferOutcome {
  transfer_id: string | null;
  state: TransferState;
  pending_reason?: PendingReason;
  /** Cents actually moved by the transfer on the rail (0 unless TRANSFERRED). */
  amount_cents: number;
  /**
   * True ONLY when Stripe definitively rejected a create for this attempt's
   * idempotency key (a decided 4xx), so the next retry must use the next
   * attempt number. False for transport errors, timeouts, 5xx, rate limits,
   * auth/config errors, lookup uncertainty, onboarding blocks and MISMATCH:
   * the key was not consumed (or must not be retried), so do not advance.
   */
  retry_safe_to_advance: boolean;
  /** True when the transfer already existed on Stripe and was adopted rather than created. */
  recovered?: boolean;
  note: string;
}
export interface RetryTransferOptions {
  /**
   * settlements.transfer_attempts at the time of the call. Each attempt gets its
   * own Stripe idempotency key: Stripe replays the stored *error* of a reused
   * key, so a fixed key could never recover after onboarding is repaired.
   * Attempt 0 keeps the historical key `atm:<task>:transfer`.
   */
  attempt?: number;
  /** settlements.stripe_transfer_id when one was recorded; verified, never duplicated. */
  known_transfer_id?: string | null;
  /** Capability poll override (tests). */
  poll?: { attempts?: number; delayMs?: number };
}
export interface CaptureResult {
  payment_state: "CAPTURED" | "MOCK";
  stripe_capture_id: string | null;
  stripe_transfer_id: string | null;
  /** settlements.payout_owed_cents: what the seller is owed for this task (the claim price). */
  owed_cents: number;
  /** settlements.payout_transferred_cents: what reached the seller's account; 0 while PENDING. */
  transferred_cents: number;
  transfer_state: TransferState;
  pending_reason?: PendingReason;
  /** See TransferOutcome.retry_safe_to_advance. */
  transfer_retry_safe_to_advance: boolean;
  note: string;
}
/** Money assertions: what the rail holds for a task right now (from Stripe or the mock ledger). */
export interface MoneyState {
  rail: PaymentMode;
  payment_intent_id: string | null;
  intent_status: string | null;
  /** Amount authorised (card hold) or charged (mpp) by the buyer. */
  authorized_cents: number;
  captured_cents: number;
  refunded_cents: number;
  transferred_cents: number;
  transfer_ids: string[];
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
  /**
   * Create the buyer's Stripe customer. With `human_onboarding` no test card
   * is attached: the person adds their own card through buyerPaymentInfo's
   * hosted setup link; without it (legacy buyers, fixtures) the shared test
   * card is attached as before.
   */
  onboardBuyer(agent: BuyerOnboardInput): Promise<Partial<AgentRow>>;
  /** Buyer payment status and, when asked, a hosted setup link (whoami / get_buyer_setup). */
  buyerPayment(agent: BuyerPaymentAgent, opts?: { includeSetup?: boolean }): Promise<BuyerPaymentSetup>;
  /**
   * Create the seller's payout account. With `human_onboarding` the account is
   * created bare (no synthetic test identity, no auto-verification) and the
   * human completes Stripe's hosted onboarding via sellerPayoutInfo's link;
   * without it (legacy workers, fixtures) the test-mode identity is applied.
   */
  onboardSeller(agent: SellerOnboardInput): Promise<Partial<AgentRow>>;
  hold(task: { id: string; max_price_cents: number }, buyer: AgentRow): Promise<HoldResult>;
  capture(task: TaskRow, seller: AgentRow | null, amountCents: number): Promise<CaptureResult>;
  release(task: TaskRow, reason: string): Promise<ReleaseResult>;
  /**
   * P1: undo a hold whose task row was never inserted (or whose insert failed).
   * Works from the HoldResult alone, is safe to call more than once, and throws
   * PAYMENT_FAILED (retryable) only when the rail could not confirm the undo.
   */
  compensateHold(task: { id: string; max_price_cents: number }, hold: HoldResult, reason: string): Promise<ReleaseResult>;
  /**
   * P2: finish a seller transfer that is still PENDING after a successful
   * capture (CONTRACT §9; A's sweep calls it with settlements.payout_owed_cents).
   * Exactly one transfer ever exists per task: a recorded id is verified, a
   * transfer Stripe already holds is adopted, and only then one is created.
   * Pass `opts.attempt = transfer_attempts` so every retry uses a fresh key.
   */
  retryTransfer?(task: TaskRow, seller: AgentRow | null, amountCents: number, opts?: RetryTransferOptions): Promise<TransferOutcome>;
  /** Money assertions for fault tests and reconciliation; never mutates. */
  inspect(task: TaskRow): Promise<MoneyState>;
  /** Seller payout status and, when pending, a hosted onboarding link (register_seller / whoami). */
  payoutOnboarding(agent: { id: string; stripe_account_id: string | null }, opts?: { includeLink?: boolean }): Promise<PayoutOnboarding>;
}

export interface BuyerOnboardInput {
  id: string;
  display_name: string;
  /** True when the buyer agent is owned by a verified human (installer OAuth); no test card is attached. */
  human_onboarding?: boolean;
  /** The verified human's email, set on the Stripe customer and prefilled in hosted setup. */
  email?: string;
}
export type BuyerPaymentAgent = { id: string; stripe_customer_id: string | null; stripe_payment_method_id: string | null };
export type BuyerPaymentStatus = "READY" | "SETUP_REQUIRED" | "UNAVAILABLE" | "MOCK";
export interface BuyerPaymentSetup {
  /** READY = a confirmed card is saved for this exact customer and holds will succeed; SETUP_REQUIRED = the person must add one. */
  buyer_payment_status: BuyerPaymentStatus;
  /** Hosted Stripe Checkout (setup mode) URL, only with includeSetup and only while SETUP_REQUIRED. */
  setup_url: string | null;
  /** Human-readable rail label; always says TEST MODE or MOCK. */
  payment_label: string;
  /** Brand and last4 of the saved card, never the number. */
  payment_method: { id: string; brand: string | null; last4: string | null } | null;
  /**
   * Set when reconciliation found a confirmed card for this customer that the
   * agent row does not record yet: the service persists it as
   * agents.stripe_payment_method_id. Never a card of another customer.
   */
  confirmed_payment_method_id: string | null;
}

export interface SellerOnboardInput {
  id: string;
  display_name: string;
  /** True when the seller agent is owned by a verified human (installer OAuth); the account then needs real onboarding. */
  human_onboarding?: boolean;
  /** The verified human's email, used as the account contact and prefilled in hosted onboarding. */
  email?: string;
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

/** One Stripe customer per buyer agent, ever (replayed on retry or concurrent sign-in). */
export function customerIdempotencyKey(agentId: string): string {
  return `atm:${agentId}:customer`;
}
/** Paths C serves for the human's return from Stripe-hosted card setup. */
export const BUYER_SETUP_RETURN_PATH = "/buyer/setup-return";
export const BUYER_SETUP_REFRESH_PATH = "/buyer/setup-refresh";

/**
 * Buyer: Stripe Customer. Legacy buyers get the shared test card attached as
 * default; a human-owned buyer gets no card at all — the person adds their own
 * through the hosted setup link, and only a card confirmed for this exact
 * customer is ever recorded (see buyerPaymentSetup).
 */
export async function onboardBuyerCustomer(stripe: Stripe, agent: BuyerOnboardInput): Promise<Partial<AgentRow>> {
  const human = agent.human_onboarding === true;
  const customer = await stripe.customers.create({
    name: agent.display_name,
    ...(human && agent.email ? { email: agent.email } : {}),
    description: human ? `Buyer ${agent.id} (human-owned, HANDOFF, test mode)` : `Buyer agent ${agent.id} (HANDOFF, test mode)`,
    metadata: { agent_id: agent.id, app: "agent-task-marketplace", onboarding: human ? "human" : "synthetic-test" },
  }, { idempotencyKey: customerIdempotencyKey(agent.id) });
  if (human) return { stripe_customer_id: customer.id, stripe_payment_method_id: null };
  // Stripe's shared test payment method; attaching clones it onto the customer.
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  return { stripe_customer_id: customer.id, stripe_payment_method_id: pm.id };
}

/** Hosted Stripe Checkout in setup mode: the person saves a card to their own customer; no charge. */
export async function buyerSetupLink(stripe: Stripe, customerId: string, baseUrl: string): Promise<string> {
  const base = baseUrl.replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    currency: "usd",
    customer: customerId,
    success_url: `${base}${BUYER_SETUP_RETURN_PATH}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}${BUYER_SETUP_REFRESH_PATH}`,
    metadata: { app: "agent-task-marketplace", purpose: "buyer-card-setup" },
  });
  if (!session.url) throw new Error("Stripe returned a setup session without a URL");
  return session.url;
}

/**
 * Direct confirmation for C's /buyer/setup-return page, which receives
 * `session_id`. Accepts the card only if the session is complete, belongs to
 * this exact customer, and its SetupIntent succeeded for the same customer;
 * then makes it the default and returns its id for the agent row. Anything
 * else returns null with a reason and attaches nothing.
 */
export async function confirmBuyerSetupSession(stripe: Stripe, agent: BuyerPaymentAgent, sessionId: string): Promise<{ stripe_payment_method_id: string | null; reason: string | null }> {
  if (!agent.stripe_customer_id) return { stripe_payment_method_id: null, reason: "buyer has no Stripe customer" };
  const customer = agent.stripe_customer_id;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
  } catch (err) {
    return { stripe_payment_method_id: null, reason: `session unreadable: ${(err as Error).message}` };
  }
  const sessionCustomer = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  if (sessionCustomer !== customer) return { stripe_payment_method_id: null, reason: "session belongs to a different customer" };
  if (session.mode !== "setup" || session.status !== "complete") return { stripe_payment_method_id: null, reason: `session is ${session.status ?? "unknown"} (${session.mode})` };
  const si = typeof session.setup_intent === "string" ? await stripe.setupIntents.retrieve(session.setup_intent) : session.setup_intent;
  if (!si) return { stripe_payment_method_id: null, reason: "session has no SetupIntent" };
  const siCustomer = typeof si.customer === "string" ? si.customer : si.customer?.id ?? null;
  const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id ?? null;
  if (si.status !== "succeeded" || siCustomer !== customer || !pm) return { stripe_payment_method_id: null, reason: `setup ${si.status} for ${siCustomer ?? "no customer"}` };
  try {
    await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pm } });
  } catch (err) {
    return { stripe_payment_method_id: null, reason: `could not set default: ${(err as Error).message}` };
  }
  return { stripe_payment_method_id: pm, reason: null };
}

/**
 * Buyer payment readiness, reconciled against Stripe. Reads only, except that a
 * card found attached to this customer is made its default. A card recorded on
 * the agent row that belongs to a different customer is ignored, never used.
 */
export async function buyerPaymentSetup(stripe: Stripe, agent: BuyerPaymentAgent, baseUrl: string, opts: { includeSetup?: boolean } = {}): Promise<BuyerPaymentSetup> {
  const label = "Stripe TEST MODE — card saved by the buyer through hosted setup; no real money";
  const none = (status: BuyerPaymentStatus, setup_url: string | null = null): BuyerPaymentSetup => ({ buyer_payment_status: status, setup_url, payment_label: label, payment_method: null, confirmed_payment_method_id: null });
  if (!agent.stripe_customer_id) return none("UNAVAILABLE");
  const customer = agent.stripe_customer_id;
  const describe = (pm: Stripe.PaymentMethod) => ({ id: pm.id, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null });
  const ownerOf = (pm: Stripe.PaymentMethod) => (typeof pm.customer === "string" ? pm.customer : pm.customer?.id ?? null);

  if (agent.stripe_payment_method_id) {
    try {
      const pm = await stripe.paymentMethods.retrieve(agent.stripe_payment_method_id);
      if (ownerOf(pm) === customer) return { buyer_payment_status: "READY", setup_url: null, payment_label: label, payment_method: describe(pm), confirmed_payment_method_id: null };
      console.warn(`[stripe] buyer ${agent.id}: recorded payment method ${pm.id} belongs to ${ownerOf(pm) ?? "nobody"}, not ${customer}; ignoring it`);
    } catch (err) {
      console.warn(`[stripe] buyer ${agent.id}: recorded payment method unreadable: ${(err as Error).message}`);
    }
  }
  // Reconcile: did the person finish hosted setup? Checkout (setup mode) attaches the card to the customer.
  const cards = await stripe.paymentMethods.list({ customer, type: "card", limit: 5 });
  const confirmed = cards.data.find((pm) => ownerOf(pm) === customer);
  if (confirmed) {
    try {
      await stripe.customers.update(customer, { invoice_settings: { default_payment_method: confirmed.id } });
    } catch (err) {
      console.warn(`[stripe] buyer ${agent.id}: could not set default payment method: ${(err as Error).message}`);
    }
    return { buyer_payment_status: "READY", setup_url: null, payment_label: label, payment_method: describe(confirmed), confirmed_payment_method_id: confirmed.id };
  }
  if (opts.includeSetup !== true) return none("SETUP_REQUIRED");
  try {
    return none("SETUP_REQUIRED", await buyerSetupLink(stripe, customer, baseUrl));
  } catch (err) {
    console.warn(`[stripe] buyer ${agent.id}: setup link not created: ${(err as Error).message}`);
    return none("SETUP_REQUIRED");
  }
}

/**
 * The shape C exposes through authenticated whoami / get_buyer_setup. A setup
 * link is minted only for a human-linked buyer that asks for one.
 */
export async function buyerPaymentInfo(agent: BuyerPaymentAgent, opts: { includeSetup?: boolean; humanLinked?: boolean } = {}): Promise<BuyerPaymentSetup> {
  const p = payments();
  if (p.mode === "mock") return { buyer_payment_status: "MOCK", setup_url: null, payment_label: p.label, payment_method: null, confirmed_payment_method_id: null };
  return p.buyerPayment(agent, { includeSetup: opts.includeSetup === true && opts.humanLinked === true });
}

export type TransfersCapability = "active" | "pending" | "restricted" | "rejected" | "unsupported" | "unknown";

export interface PayoutStatus {
  account_id: string;
  /** `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status` */
  transfers: TransfersCapability;
  /** Requirement entries that still restrict `stripe_balance.stripe_transfers`. */
  blocking: string[];
  /** True when the account was created for a verified human (metadata.onboarding = "human"): never auto-verified. */
  human_onboarding: boolean;
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
    product_description: `Seller agent "${agent.display_name}" rents idle local compute on the HANDOFF (test mode).`,
  };
}

function readPayoutStatus(account: Stripe.V2.Core.Account): PayoutStatus {
  const cap = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers;
  const blocking = (account.requirements?.entries ?? [])
    .filter((e) => (e.impact?.restricts_capabilities ?? []).some((r) => r.capability === "stripe_balance.stripe_transfers"))
    .map((e) => e.description);
  return { account_id: account.id, transfers: (cap?.status as TransfersCapability | undefined) ?? "unknown", blocking, human_onboarding: account.metadata?.onboarding === "human" };
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
/**
 * One payout account per seller agent, ever. The create carries a stable
 * idempotency key, so a lost response or two concurrent OAuth completions
 * replay the same account instead of creating a second one. Stripe keeps a
 * key's result for 24 h; the service retries onboardSeller with the same
 * agent id inside PAYOUT_ACCOUNT_RETRY_POLICY.window_hours of the first
 * attempt and stops automatic retries after that (an operator reconciles).
 */
export function payoutAccountIdempotencyKey(agentId: string): string {
  return `atm:${agentId}:payout-account`;
}
export const PAYOUT_ACCOUNT_RETRY_POLICY = Object.freeze({
  /** Automatic retries of onboardSeller for the same agent (first attempt included). */
  max_attempts: 3,
  /** Retry only within this window after the first attempt; Stripe's idempotency results expire at 24 h. */
  window_hours: 20,
  /** Minimum delay between attempts. */
  backoff_ms: 5_000,
});

/** Paths C serves for the human's return from Stripe-hosted onboarding (hosted server base URL + path). */
export const SELLER_SETUP_RETURN_PATH = "/seller/setup-return";
export const SELLER_SETUP_REFRESH_PATH = "/seller/setup-refresh";

export async function createRecipientAccount(stripe: Stripe, agent: SellerOnboardInput): Promise<PayoutStatus> {
  const human = agent.human_onboarding === true;
  const account = await stripe.v2.core.accounts.create({
    display_name: agent.display_name,
    contact_email: human && agent.email ? agent.email : `${agent.id}@agenttaskmarket.dev`,
    dashboard: "none",
    defaults: {
      currency: "usd",
      responsibilities: { fees_collector: "application", losses_collector: "application" },
      // A human account states its own profile in hosted onboarding; the synthetic one needs a URL to pass test-mode checks.
      ...(human ? {} : { profile: recipientProfile(agent) }),
    },
    // Human-owned accounts get no synthetic identity: Stripe collects it in the hosted flow and verifies it.
    identity: human ? { country: "us" } : testModeRecipientIdentity(agent),
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    metadata: { agent_id: agent.id, app: "agent-task-marketplace", onboarding: human ? "human" : "synthetic-test" },
    include: [...ACCOUNT_INCLUDE],
  }, { idempotencyKey: payoutAccountIdempotencyKey(agent.id) });
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
  if (status.human_onboarding) return status; // a real person's account: only Stripe's hosted onboarding may change it
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

/** What the seller surface shows about payouts (register_seller / whoami, seller installer step 6). */
export interface PayoutOnboarding {
  /** active = transfers will succeed; pending = account exists but needs the hosted onboarding; none = no connected account. */
  payout_status: "active" | "pending" | "none";
  /** Hosted Stripe Connect onboarding URL when pending (single-use, expires); null otherwise. */
  onboarding_url: string | null;
  /** Requirement descriptions still blocking transfers (from Stripe), empty when active. */
  blocking: string[];
}

/**
 * Payout status plus, when needed, a fresh hosted onboarding link for the seller
 * to finish identity verification. Never throws: a link that cannot be created
 * just comes back null with the blocking list, so registration keeps working.
 */
export async function sellerPayoutOnboarding(stripe: Stripe, agent: { id: string; stripe_account_id: string | null }, baseUrl: string, opts: { includeLink?: boolean } = {}): Promise<PayoutOnboarding> {
  if (!agent.stripe_account_id) return { payout_status: "none", onboarding_url: null, blocking: ["no connected account; re-run register_seller"] };
  let status: PayoutStatus;
  try {
    status = await payoutStatus(stripe, agent.stripe_account_id);
  } catch (err) {
    return { payout_status: "pending", onboarding_url: null, blocking: [`could not read the connected account: ${(err as Error).message}`] };
  }
  if (status.transfers === "active") return { payout_status: "active", onboarding_url: null, blocking: [] };
  let url: string | null = null;
  if (opts.includeLink !== false) {
    try {
      url = await onboardingLink(stripe, agent.stripe_account_id, baseUrl, { human: status.human_onboarding });
    } catch (err) {
      console.warn(`[stripe] onboarding link for ${agent.stripe_account_id} not created: ${(err as Error).message}`);
    }
  }
  return { payout_status: "pending", onboarding_url: url, blocking: status.blocking };
}

/** The shape C exposes through authenticated `whoami` / `get_seller_onboarding` (C-D-20261018T045049Z-01). */
export type SellerPayoutStatus = "ACTIVE" | "PENDING_ONBOARDING" | "UNAVAILABLE" | "MOCK";
export interface SellerPayoutInfo {
  /** ACTIVE = the transfer capability is active on the connected account; never a claim that a real payout happened. */
  payout_status: SellerPayoutStatus;
  /** Hosted Stripe Connect onboarding URL, only with includeLink and only while PENDING_ONBOARDING. */
  payout_onboarding_url: string | null;
  /** Human-readable rail label; always says TEST MODE or MOCK. */
  payout_label: string;
  /** Requirement descriptions still blocking transfers, empty unless pending. */
  blocking: string[];
}

/**
 * Payout status for one seller on the configured rail. Reads only; creates a
 * single-use onboarding link only when `includeLink` is true, the caller
 * asserts `humanLinked` (the seller agent is tied to an authenticated human
 * account — the installer's OAuth step), and the account is still
 * restricted. An unlinked agent never receives a Stripe Connect link, so an
 * anonymous process cannot start payout onboarding. Never registers, resets
 * or mutates the seller.
 */
export async function sellerPayoutInfo(
  agent: { id: string; stripe_account_id: string | null },
  opts: { includeLink?: boolean; humanLinked?: boolean } = {},
): Promise<SellerPayoutInfo> {
  const p = payments();
  const label = `${p.label}; ACTIVE means the Stripe transfer capability is active, not a verified real payout`;
  if (p.mode === "mock") return { payout_status: "MOCK", payout_onboarding_url: null, payout_label: label, blocking: [] };
  const mayLink = opts.includeLink === true && opts.humanLinked === true;
  const r = await p.payoutOnboarding(agent, { includeLink: mayLink });
  if (opts.includeLink === true && !mayLink && r.payout_status === "pending") {
    r.blocking = [...r.blocking, "link the seller to a human account before payout onboarding"];
  }
  const payout_status: SellerPayoutStatus = r.payout_status === "active" ? "ACTIVE" : r.payout_status === "pending" ? "PENDING_ONBOARDING" : "UNAVAILABLE";
  return { payout_status, payout_onboarding_url: r.onboarding_url, payout_label: label, blocking: r.blocking };
}

/**
 * Hosted Connect onboarding for a real seller (single-use URL; the installer
 * prints and opens it). Human-owned accounts return to C's setup pages, which
 * explain the outcome and lead back to the localhost dashboard, where an
 * authenticated click mints a fresh link; legacy accounts keep /api/dashboard.
 */
export async function onboardingLink(stripe: Stripe, accountId: string, baseUrl: string, opts: { human?: boolean } = {}): Promise<string> {
  const base = baseUrl.replace(/\/$/, "");
  const return_url = opts.human ? `${base}${SELLER_SETUP_RETURN_PATH}` : `${base}/api/dashboard`;
  const refresh_url = opts.human ? `${base}${SELLER_SETUP_REFRESH_PATH}` : `${base}/api/dashboard`;
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: { type: "account_onboarding", account_onboarding: { refresh_url, return_url } },
  });
  return link.url;
}

/**
 * Did Stripe decide this request (so its result is stored under the
 * idempotency key and a retry must use a new key)? Decided means a 4xx the
 * API produced after executing: card/invalid-request/idempotency/permission
 * errors. Connection errors, timeouts, 5xx, 429 and 401 leave the key
 * unconsumed or the outcome unknown.
 */
export function stripeDefinitivelyRejected(err: unknown): boolean {
  const e = err as { type?: string; code?: string; statusCode?: number; definitive?: boolean } | null;
  if (!e || typeof e !== "object") return false;
  if (typeof e.definitive === "boolean") return e.definitive; // mock/test hook
  // A key conflict can mean another create is still executing or already
  // succeeded. Never change the key in response to that ambiguity.
  if (e.type === "StripeIdempotencyError" || e.code === "idempotency_key_in_use" || [401, 403, 408, 409, 429].includes(e.statusCode ?? 0)) return false;
  if (e.type === "StripePermissionError") return false;
  if (e.type === "StripeCardError" || e.type === "StripeInvalidRequestError") return true;
  if (e.type === "StripeConnectionError" || e.type === "StripeAPIError" || e.type === "StripeRateLimitError" || e.type === "StripeAuthenticationError") return false;
  const code = e.statusCode ?? 0;
  return code >= 400 && code < 500 && code !== 401 && code !== 403 && code !== 408 && code !== 409 && code !== 429;
}

/** Non-reversed transfers Stripe holds for this task (by transfer_group), any destination. */
export async function findTransfersForTask(stripe: Stripe, taskId: string): Promise<Stripe.Transfer[]> {
  const page = await stripe.transfers.list({ transfer_group: taskId, limit: 10 });
  return page.data.filter((t) => !t.reversed);
}

/** A transfer counts for this task only if every money-relevant field matches what the task owes. */
export function transferMatches(t: Stripe.Transfer, expect: { task_id: string; destination: string; amount_cents: number }): string | null {
  const dest = typeof t.destination === "string" ? t.destination : t.destination?.id ?? null;
  if (t.reversed) return `transfer ${t.id} is reversed`;
  if (t.transfer_group !== expect.task_id) return `transfer ${t.id} belongs to ${t.transfer_group ?? "no task"}, not ${expect.task_id}`;
  if (dest !== expect.destination) return `transfer ${t.id} went to ${dest ?? "unknown"}, not ${expect.destination}`;
  if (t.currency !== "usd") return `transfer ${t.id} is ${t.currency}, not usd`;
  if (t.amount !== expect.amount_cents) return `transfer ${t.id} moved ${t.amount}c, task owes ${expect.amount_cents}c`;
  return null;
}

export function holdIdempotencyKey(taskId: string): string {
  return `atm:${taskId}:hold`;
}

/**
 * What a failed hold() means for the service (CONTRACT §9 recovery):
 * "not_created" — the rail definitively rejected it, no intent exists, the
 * reservation may be released; "unknown" — timeout/transport/5xx or an
 * idempotency conflict, an intent may exist, so keep the reservation and
 * replay hold() with the same task id (its key returns the same intent).
 */
export type HoldOutcome = "not_created" | "unknown";
export function holdOutcomeOf(err: unknown): HoldOutcome {
  const e = err as { hold_outcome?: HoldOutcome } | null;
  if (e && typeof e === "object" && (e.hold_outcome === "not_created" || e.hold_outcome === "unknown")) return e.hold_outcome;
  return stripeDefinitivelyRejected(err) ? "not_created" : "unknown";
}
function holdError(message: string, outcome: HoldOutcome, next_action: string, retryable = outcome === "unknown"): MarketplaceError {
  const err = new MarketplaceError("PAYMENT_FAILED", message, { retryable, next_action });
  return Object.assign(err, { hold_outcome: outcome });
}

export function transferIdempotencyKey(taskId: string, attempt: number): string {
  return attempt === 0 ? `atm:${taskId}:transfer` : `atm:${taskId}:transfer:r${attempt}`;
}

/**
 * Move the captured amount to the seller's connected account — at most once
 * per task, and never mislabelled. Order: a recorded transfer id is verified
 * field by field; a transfer Stripe already holds for this task is adopted
 * only if it matches destination, amount, currency and group; anything that
 * exists but does not match becomes PENDING/MISMATCH for an operator instead
 * of being claimed as paid; only then is one created, with an attempt-scoped
 * idempotency key. `source_transaction` ties it to the buyer's charge.
 * Never throws: the outcome says whether and how much the seller was paid.
 *
 * Exactly-once across *concurrent* retries is the service's job: the lookup
 * cannot see a transfer another process is creating at the same moment, so
 * the sweep must hold a per-settlement lease/CAS before calling (CONTRACT §9).
 */
export async function reconcileSellerTransfer(
  stripe: Stripe,
  task: { id: string },
  seller: AgentRow | null,
  amountCents: number,
  chargeId: string | null,
  opts: RetryTransferOptions = {},
): Promise<TransferOutcome> {
  if (amountCents <= 0) return { transfer_id: null, state: "NOT_APPLICABLE", amount_cents: 0, retry_safe_to_advance: false, note: "nothing owed to the seller" };
  if (!seller?.stripe_account_id) return { transfer_id: null, state: "PENDING", pending_reason: "PENDING_ONBOARDING", amount_cents: 0, retry_safe_to_advance: false, note: "seller has no connected account (payout PENDING_ONBOARDING)" };
  const destination = seller.stripe_account_id;
  const expect = { task_id: task.id, destination, amount_cents: amountCents };

  if (opts.known_transfer_id) {
    try {
      const t = await stripe.transfers.retrieve(opts.known_transfer_id);
      const problem = transferMatches(t, expect);
      if (!problem) return { transfer_id: t.id, state: "TRANSFERRED", amount_cents: t.amount, retry_safe_to_advance: false, note: `transfer ${t.id} verified (${t.amount}c to ${destination})` };
      return { transfer_id: null, state: "PENDING", pending_reason: "MISMATCH", amount_cents: 0, retry_safe_to_advance: false, note: `recorded transfer does not match the task: ${problem}; needs operator reconciliation` };
    } catch (err) {
      return { transfer_id: null, state: "PENDING", pending_reason: "LOOKUP_ERROR", amount_cents: 0, retry_safe_to_advance: false, note: `recorded transfer ${opts.known_transfer_id} could not be read: ${(err as Error).message}; retry pending` };
    }
  }

  let existing: Stripe.Transfer[];
  try {
    existing = await findTransfersForTask(stripe, task.id);
  } catch (err) {
    return { transfer_id: null, state: "PENDING", pending_reason: "LOOKUP_ERROR", amount_cents: 0, retry_safe_to_advance: false, note: `transfer lookup failed: ${(err as Error).message}; retry pending` };
  }
  if (existing.length) {
    const match = existing.find((t) => transferMatches(t, expect) === null);
    if (match) return { transfer_id: match.id, state: "TRANSFERRED", amount_cents: match.amount, retry_safe_to_advance: false, recovered: true, note: `recovered existing transfer ${match.id} (${match.amount}c to ${destination})` };
    const problems = existing.map((t) => transferMatches(t, expect)).filter(Boolean).join("; ");
    return { transfer_id: null, state: "PENDING", pending_reason: "MISMATCH", amount_cents: 0, retry_safe_to_advance: false, note: `Stripe holds a transfer for this task that does not match what it owes (${problems}); not creating another; needs operator reconciliation` };
  }

  const status = await ensureTransfersActive(stripe, destination, seller, opts.poll ?? {});
  if (status.transfers !== "active") {
    return { transfer_id: null, state: "PENDING", pending_reason: "PENDING_ONBOARDING", amount_cents: 0, retry_safe_to_advance: false, note: `transfer PENDING_ONBOARDING: ${destination} stripe_transfers=${status.transfers} (${status.blocking.join(", ") || "no details"})` };
  }
  const attempt = opts.attempt ?? 0;
  try {
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination,
      transfer_group: task.id,
      ...(chargeId ? { source_transaction: chargeId } : {}),
      metadata: { task_id: task.id, seller_id: seller.id, app: "agent-task-marketplace", attempt: String(attempt) },
    }, { idempotencyKey: transferIdempotencyKey(task.id, attempt) });
    const problem = transferMatches(transfer, expect);
    if (problem) {
      // An idempotent replay of an older request with other parameters, or a partial transfer: do not call it paid.
      return { transfer_id: null, state: "PENDING", pending_reason: "MISMATCH", amount_cents: 0, retry_safe_to_advance: false, note: `created transfer does not match the task: ${problem}; needs operator reconciliation` };
    }
    return { transfer_id: transfer.id, state: "TRANSFERRED", amount_cents: transfer.amount, retry_safe_to_advance: false, note: `transferred ${transfer.amount}c to ${destination} (${transfer.id}${attempt ? `, attempt ${attempt}` : ""})` };
  } catch (err) {
    const definitive = stripeDefinitivelyRejected(err);
    return { transfer_id: null, state: "PENDING", pending_reason: "PROVIDER_ERROR", amount_cents: 0, retry_safe_to_advance: definitive, note: `transfer ${definitive ? "rejected" : "uncertain"} (attempt ${attempt}): ${(err as Error).message}; ${definitive ? "next retry must use attempt " + (attempt + 1) : "retry with the same attempt key"}` };
  }
}

/** First-attempt transfer used by capture(); same reconciliation as a retry. */
export function transferToSeller(stripe: Stripe, task: { id: string }, seller: AgentRow | null, amountCents: number, chargeId: string | null): Promise<TransferOutcome> {
  return reconcileSellerTransfer(stripe, task, seller, amountCents, chargeId, { attempt: 0 });
}

/** P1 helper: cancel a card hold that belongs to a task that was never inserted. Idempotent. */
export async function compensateStripeHold(stripe: Stripe, task: { id: string }, hold: HoldResult, reason: string): Promise<ReleaseResult> {
  if (!hold.stripe_payment_intent_id) return { payment_state: "RELEASED", note: `no PaymentIntent to undo (${reason})` };
  try {
    const pi = await stripe.paymentIntents.cancel(hold.stripe_payment_intent_id, { cancellation_reason: "abandoned" }, { idempotencyKey: `atm:${task.id}:cancel` });
    return { payment_state: "RELEASED", note: `hold ${pi.id} cancelled (${reason})` };
  } catch (err) {
    // Already cancelled or captured? Read the truth before giving up.
    try {
      const pi = await stripe.paymentIntents.retrieve(hold.stripe_payment_intent_id);
      if (pi.status === "canceled") return { payment_state: "RELEASED", note: `hold ${pi.id} was already cancelled (${reason})` };
    } catch { /* fall through */ }
    throw new MarketplaceError("PAYMENT_FAILED", "Stripe could not confirm the hold was undone.", { retryable: true, next_action: `Retry compensation for ${task.id}; the cancel uses an idempotency key.` });
  }
}

/** Money state of a task on Stripe: intent, captured, refunded, transferred. Read-only. */
export async function inspectStripeMoney(stripe: Stripe, task: TaskRow): Promise<MoneyState> {
  const state: MoneyState = { rail: task.payment_mode, payment_intent_id: task.stripe_payment_intent_id, intent_status: null, authorized_cents: 0, captured_cents: 0, refunded_cents: 0, transferred_cents: 0, transfer_ids: [] };
  if (task.stripe_payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(task.stripe_payment_intent_id);
    state.intent_status = pi.status;
    state.authorized_cents = pi.status === "canceled" ? 0 : pi.amount;
    state.captured_cents = pi.amount_received;
    const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 20 });
    state.refunded_cents = refunds.data.filter((r) => r.status !== "failed" && r.status !== "canceled").reduce((sum, r) => sum + r.amount, 0);
  }
  for (const t of await findTransfersForTask(stripe, task.id)) {
    state.transfer_ids.push(t.id);
    state.transferred_cents += t.amount;
  }
  return state;
}

/** Shared seller onboarding used by both Stripe providers. Never throws. */
export async function onboardSellerAccount(stripe: Stripe, agent: SellerOnboardInput): Promise<Partial<AgentRow>> {
  try {
    const status = await createRecipientAccount(stripe, agent);
    if (status.transfers !== "active" && !status.human_onboarding) {
      console.warn(`[stripe] ${status.account_id}: stripe_transfers=${status.transfers}; blocking: ${status.blocking.join(", ") || "none"}`);
    }
    return { stripe_account_id: status.account_id };
  } catch (err) {
    const e = err as { type?: string; message?: string };
    if (e?.type === "StripeIdempotencyError") {
      // Same agent id, different parameters (e.g. the email changed between attempts): the first
      // account exists on Stripe. Replay with the original parameters, or let an operator reconcile.
      console.warn(`[stripe] payout account for ${agent.id}: idempotency conflict; retry with the first attempt's parameters`);
    } else {
      console.warn(`[stripe] connected account for ${agent.id} not created: ${e?.message ?? String(err)}`);
    }
    return { stripe_account_id: null };
  }
}

// ---------------------------------------------------------------------------
// Mock: no money moves. Every surface that shows it says so.
// ---------------------------------------------------------------------------

/**
 * Fault injection for offline tests (PAYMENT_MODE=mock, DB_MODE=memory):
 * MOCK_PAYMENT_FAULTS="hold,capture,transfer:2,release,compensate"
 * A bare step fails every call; `step:N` fails the first N calls to that step.
 * `transfer` makes capture() report a failed transfer instead of throwing, so
 * the P2 retry path can be exercised; `retryTransfer` counts against the same
 * budget. setMockFaults() overrides the env for unit tests.
 */
export type MockFaultStep = "hold" | "capture" | "transfer" | "release" | "compensate";
let mockFaultSpec: string | null | undefined;
const mockFaultBudget = new Map<MockFaultStep, { left: number; transient: boolean }>();
/** `transfer:2` = two definitive failures; `transfer~:2` = two transient ones (key not consumed). */
export function setMockFaults(spec: string | null): void {
  mockFaultSpec = spec;
  mockFaultBudget.clear();
  for (const entry of (spec ?? "").split(",").map((e) => e.trim()).filter(Boolean)) {
    const [rawStep, n] = entry.split(":");
    const transient = rawStep!.endsWith("~");
    const step = (transient ? rawStep!.slice(0, -1) : rawStep!) as MockFaultStep;
    mockFaultBudget.set(step, { left: n === undefined ? Number.POSITIVE_INFINITY : Number(n), transient });
  }
}
/** Returns null when the step succeeds, else whether the injected failure is definitive. */
function mockFault(step: MockFaultStep): { definitive: boolean } | null {
  if (mockFaultSpec === undefined) setMockFaults(process.env.MOCK_PAYMENT_FAULTS ?? null);
  const b = mockFaultBudget.get(step);
  if (!b || b.left <= 0) return null;
  b.left -= 1;
  return { definitive: !b.transient };
}
function mockFaultFires(step: MockFaultStep): boolean {
  return mockFault(step) !== null;
}

interface MockLedgerEntry { held: number; captured: number; refunded: number; transferred: number; transfer_id: string | null; state: "HELD" | "CAPTURED" | "RELEASED" }
const mockLedger = new Map<string, MockLedgerEntry>();
/** Test hook: the mock rail's ledger for a task. */
export function mockLedgerFor(taskId: string): MockLedgerEntry | undefined {
  return mockLedger.get(taskId);
}

class MockProvider implements PaymentProvider {
  readonly mode = "mock" as const;
  readonly label = "MOCK — no payment rail connected";
  readonly min_cents = 1;
  async onboardBuyer() { return {}; }
  async onboardSeller() { return {}; }
  async hold(task: { id: string; max_price_cents: number }): Promise<HoldResult> {
    const fault = mockFault("hold");
    if (fault) throw holdError(`MOCK fault: hold ${fault.definitive ? "refused" : "uncertain"}.`, fault.definitive ? "not_created" : "unknown", "Retry post_task.");
    mockLedger.set(task.id, { held: task.max_price_cents, captured: 0, refunded: 0, transferred: 0, transfer_id: null, state: "HELD" });
    return { payment_state: "MOCK", stripe_payment_intent_id: `mock_pi_${task.id}`, payment_link: null, task_status: "OPEN", note: "mock hold (no payment rail)" };
  }
  async capture(task: TaskRow, seller: AgentRow | null, amountCents: number): Promise<CaptureResult> {
    if (mockFaultFires("capture")) throw new MarketplaceError("PAYMENT_FAILED", "MOCK fault: capture refused.", { retryable: true, next_action: "Retry submit_verdict." });
    const entry = mockLedger.get(task.id) ?? { held: task.max_price_cents, captured: 0, refunded: 0, transferred: 0, transfer_id: null, state: "HELD" as const };
    entry.captured = amountCents; // idempotent: a second capture does not add
    entry.state = "CAPTURED";
    mockLedger.set(task.id, entry);
    const transfer = await this.mockTransfer(task, seller, amountCents, 0);
    return {
      payment_state: "MOCK",
      stripe_capture_id: `mock_ch_${task.id}`,
      stripe_transfer_id: transfer.transfer_id,
      owed_cents: amountCents,
      transferred_cents: transfer.amount_cents,
      transfer_state: transfer.state,
      pending_reason: transfer.pending_reason,
      transfer_retry_safe_to_advance: transfer.retry_safe_to_advance,
      note: `mock payout of ${amountCents}c (no payment rail); ${transfer.note}`,
    };
  }
  async release(task: TaskRow, reason: string): Promise<ReleaseResult> {
    if (mockFaultFires("release")) throw new MarketplaceError("PAYMENT_FAILED", "MOCK fault: release refused.", { retryable: true, next_action: "Retry the same cancellation or verdict." });
    const entry = mockLedger.get(task.id);
    if (entry && entry.state !== "RELEASED") { entry.refunded = entry.captured || entry.held; entry.state = "RELEASED"; }
    return { payment_state: "MOCK", note: `mock release (no payment rail): ${reason}` };
  }
  async compensateHold(task: { id: string; max_price_cents: number }, _hold: HoldResult, reason: string): Promise<ReleaseResult> {
    if (mockFaultFires("compensate")) throw new MarketplaceError("PAYMENT_FAILED", "MOCK fault: compensation refused.", { retryable: true, next_action: "Retry compensation." });
    const entry = mockLedger.get(task.id);
    if (entry) { entry.state = "RELEASED"; entry.held = 0; }
    return { payment_state: "MOCK", note: `mock hold undone (${reason})` };
  }
  retryTransfer(task: TaskRow, seller: AgentRow | null, amountCents: number, opts: RetryTransferOptions = {}): Promise<TransferOutcome> {
    if (amountCents <= 0) return Promise.resolve({ transfer_id: null, state: "NOT_APPLICABLE", amount_cents: 0, retry_safe_to_advance: false, note: "nothing owed to the seller" });
    return this.mockTransfer(task, seller, amountCents, opts.attempt ?? 0);
  }
  async payoutOnboarding(): Promise<PayoutOnboarding> {
    return { payout_status: "active", onboarding_url: null, blocking: [] }; // mock rail: nothing to onboard
  }
  async buyerPayment(): Promise<BuyerPaymentSetup> {
    return { buyer_payment_status: "MOCK", setup_url: null, payment_label: this.label, payment_method: null, confirmed_payment_method_id: null };
  }
  async inspect(task: TaskRow): Promise<MoneyState> {
    const e = mockLedger.get(task.id);
    return {
      rail: "mock",
      payment_intent_id: task.stripe_payment_intent_id,
      intent_status: e?.state ?? null,
      authorized_cents: e?.state === "RELEASED" ? 0 : e?.held ?? 0,
      captured_cents: e?.captured ?? 0,
      refunded_cents: e?.refunded ?? 0,
      transferred_cents: e?.transferred ?? 0,
      transfer_ids: e?.transfer_id ? [e.transfer_id] : [],
    };
  }
  private async mockTransfer(task: { id: string }, seller: AgentRow | null, amountCents: number, attempt: number): Promise<TransferOutcome> {
    const entry = mockLedger.get(task.id);
    if (entry?.transfer_id) {
      if (entry.transferred !== amountCents) return { transfer_id: null, state: "PENDING", pending_reason: "MISMATCH", amount_cents: 0, retry_safe_to_advance: false, note: `mock transfer ${entry.transfer_id} moved ${entry.transferred}c, task owes ${amountCents}c; needs operator reconciliation` };
      return { transfer_id: entry.transfer_id, state: "TRANSFERRED", amount_cents: entry.transferred, retry_safe_to_advance: false, recovered: attempt > 0, note: `mock transfer ${entry.transfer_id} already exists` };
    }
    if (!seller) return { transfer_id: null, state: "PENDING", pending_reason: "PENDING_ONBOARDING", amount_cents: 0, retry_safe_to_advance: false, note: "seller unknown (payout PENDING_ONBOARDING)" };
    const fault = mockFault("transfer");
    if (fault) return { transfer_id: null, state: "PENDING", pending_reason: "PROVIDER_ERROR", amount_cents: 0, retry_safe_to_advance: fault.definitive, note: `MOCK fault: transfer ${fault.definitive ? "rejected" : "uncertain"} (attempt ${attempt}); retry pending` };
    const id = `mock_tr_${task.id}`;
    if (entry) { entry.transferred = amountCents; entry.transfer_id = id; }
    return { transfer_id: id, state: "TRANSFERRED", amount_cents: amountCents, retry_safe_to_advance: false, note: `mock transfer ${id} of ${amountCents}c${attempt ? ` (attempt ${attempt})` : ""}` };
  }
}

// ---------------------------------------------------------------------------
// Stripe test mode, "card" flow: manual-capture hold at post_task, capture of
// the claim price on APPROVE (remainder auto-released), cancel on REJECT or
// expiry, Connect transfer of the captured amount to the seller.
// ---------------------------------------------------------------------------

export class StripeCardProvider implements PaymentProvider {
  readonly mode = "card" as const;
  readonly label = "Stripe TEST MODE — manual-capture hold on the buyer's saved test card";
  readonly min_cents = 50; // Stripe minimum charge for USD
  private readonly stripe: Stripe;

  /** `client` lets tests inject a fake; production builds one from the test-mode key. */
  constructor(secretKey: string | undefined, client?: Stripe) {
    this.stripe = client ?? createStripe(secretKey);
  }

  onboardBuyer(agent: BuyerOnboardInput): Promise<Partial<AgentRow>> {
    return onboardBuyerCustomer(this.stripe, agent);
  }

  buyerPayment(agent: BuyerPaymentAgent, opts: { includeSetup?: boolean } = {}): Promise<BuyerPaymentSetup> {
    return buyerPaymentSetup(this.stripe, agent, env().baseUrl, opts);
  }

  onboardSeller(agent: SellerOnboardInput): Promise<Partial<AgentRow>> {
    return onboardSellerAccount(this.stripe, agent);
  }

  async hold(task: { id: string; max_price_cents: number }, buyer: AgentRow): Promise<HoldResult> {
    if (!buyer.stripe_customer_id || !buyer.stripe_payment_method_id) {
      throw new MarketplaceError("PAYMENT_FAILED", "Buyer has no payment method on file.", {
        next_action: "Re-register the buyer agent so a test card is attached.",
      });
    }
    // One hold per task id, ever: the task-scoped idempotency key makes a retry
    // after an ambiguous response (timeout, lost reply) replay the same
    // PaymentIntent instead of authorising the buyer twice. The service must
    // retry with the same task id and amount; a different amount is an
    // idempotency error, surfaced below.
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
        description: `HANDOFF hold for ${task.id} (TEST MODE)`,
        metadata: { task_id: task.id, buyer_id: buyer.id, app: "agent-task-marketplace" },
      }, { idempotencyKey: holdIdempotencyKey(task.id) });
    } catch (err) {
      const e = err as { type?: string; message?: string };
      if (e?.type === "StripeIdempotencyError") {
        // An intent for this task id exists with other parameters: not "not_created".
        throw holdError("A hold for this task id already exists with different parameters.", "unknown", "Retry with the same amount, or post the task under a new id.", false);
      }
      if (stripeDefinitivelyRejected(err)) {
        throw holdError("Stripe refused the test-card hold.", "not_created", "Check the buyer test payment method, then post a new task.");
      }
      throw holdError("Stripe did not confirm the hold.", "unknown", "Retry post_task for the same task id; the hold uses an idempotency key, so no second authorisation is created.");
    }
    if (pi.status !== "requires_capture") {
      // A replay can return a hold that was already compensated or captured: an intent exists.
      throw Object.assign(
        new MarketplaceError("PAYMENT_FAILED", `PaymentIntent ${pi.id} is ${pi.status}; expected requires_capture.`, {
          retryable: false,
          next_action: pi.status === "canceled" ? "This task's hold was already released; post a new task." : "Check this PaymentIntent in Stripe before posting another task.",
        }),
        { hold_outcome: "unknown" as HoldOutcome },
      );
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
      return { payment_state: "CAPTURED", stripe_capture_id: null, stripe_transfer_id: null, owed_cents: amountCents, transferred_cents: 0, transfer_state: "NOT_APPLICABLE", transfer_retry_safe_to_advance: false, note: "no PaymentIntent on task; nothing captured" };
    }
    const pi = await this.stripe.paymentIntents.capture(task.stripe_payment_intent_id, { amount_to_capture: amountCents }, { idempotencyKey: `atm:${task.id}:capture` });
    const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    const transfer = await transferToSeller(this.stripe, task, seller, amountCents, chargeId);
    const note = `captured ${amountCents}c of the ${task.max_price_cents}c hold (${pi.id}); remainder released; ${transfer.note}`;
    return {
      payment_state: "CAPTURED",
      stripe_capture_id: chargeId,
      stripe_transfer_id: transfer.transfer_id,
      owed_cents: amountCents,
      transferred_cents: transfer.amount_cents,
      transfer_state: transfer.state,
      pending_reason: transfer.pending_reason,
      transfer_retry_safe_to_advance: transfer.retry_safe_to_advance,
      note,
    };
  }

  compensateHold(task: { id: string; max_price_cents: number }, hold: HoldResult, reason: string): Promise<ReleaseResult> {
    return compensateStripeHold(this.stripe, task, hold, reason);
  }

  async retryTransfer(task: TaskRow, seller: AgentRow | null, amountCents: number, opts: RetryTransferOptions = {}): Promise<TransferOutcome> {
    const chargeId = await this.chargeIdFor(task);
    return reconcileSellerTransfer(this.stripe, task, seller, amountCents, chargeId, opts);
  }

  /** The buyer's charge for `source_transaction`, read from the PaymentIntent. */
  private async chargeIdFor(task: TaskRow): Promise<string | null> {
    if (!task.stripe_payment_intent_id) return null;
    try {
      const pi = await this.stripe.paymentIntents.retrieve(task.stripe_payment_intent_id);
      return typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    } catch {
      return null;
    }
  }

  inspect(task: TaskRow): Promise<MoneyState> {
    return inspectStripeMoney(this.stripe, task);
  }

  payoutOnboarding(agent: { id: string; stripe_account_id: string | null }, opts: { includeLink?: boolean } = {}): Promise<PayoutOnboarding> {
    return sellerPayoutOnboarding(this.stripe, agent, env().baseUrl, opts);
  }

  async release(task: TaskRow, reason: string): Promise<ReleaseResult> {
    if (!task.stripe_payment_intent_id) return { payment_state: "RELEASED", note: "no PaymentIntent on task" };
    try {
      const pi = await this.stripe.paymentIntents.cancel(task.stripe_payment_intent_id, { cancellation_reason: "requested_by_customer" }, { idempotencyKey: `atm:${task.id}:cancel` });
      return { payment_state: "RELEASED", note: `hold ${pi.id} cancelled (${reason})` };
    } catch (err) {
      throw new MarketplaceError("PAYMENT_FAILED", "Stripe could not confirm release of the hold.", { retryable: true, next_action: "Retry the same cancellation or verdict after checking Stripe." });
    }
  }
}

// ---------------------------------------------------------------------------
// Routing: settlement follows the task's own payment_mode. Tasks posted while
// the server ran in one mode must still capture/release correctly when a
// different server (or the same one restarted in another mode) judges them —
// the Insforge DB is shared by every computer during the hackathon.
// ---------------------------------------------------------------------------

class RoutingProvider implements PaymentProvider {
  private readonly byMode = new Map<PaymentMode, PaymentProvider>();

  constructor(private readonly configured: PaymentProvider, private readonly e: { STRIPE_SECRET_KEY?: string | undefined; STRIPE_PROFILE_ID?: string | undefined; baseUrl: string }) {
    this.byMode.set(configured.mode, configured);
  }
  get mode() { return this.configured.mode; }
  get label() { return this.configured.label; }
  get min_cents() { return this.configured.min_cents; }
  onboardBuyer(agent: BuyerOnboardInput) { return this.configured.onboardBuyer(agent); }
  buyerPayment(agent: BuyerPaymentAgent, opts?: { includeSetup?: boolean }) { return this.configured.buyerPayment(agent, opts); }
  onboardSeller(agent: SellerOnboardInput) { return this.configured.onboardSeller(agent); }
  hold(task: { id: string; max_price_cents: number }, buyer: AgentRow) { return this.configured.hold(task, buyer); }
  capture(task: TaskRow, seller: AgentRow | null, amountCents: number) { return this.for(task.payment_mode).capture(task, seller, amountCents); }
  release(task: TaskRow, reason: string) { return this.for(task.payment_mode).release(task, reason); }
  compensateHold(task: { id: string; max_price_cents: number }, hold: HoldResult, reason: string) { return this.configured.compensateHold(task, hold, reason); }
  retryTransfer(task: TaskRow, seller: AgentRow | null, amountCents: number, opts?: RetryTransferOptions): Promise<TransferOutcome> {
    const p = this.for(task.payment_mode);
    if (!p.retryTransfer) return Promise.resolve({ transfer_id: null, state: "PENDING", pending_reason: "PROVIDER_ERROR", amount_cents: 0, retry_safe_to_advance: false, note: `${p.mode} rail cannot retry transfers` });
    return p.retryTransfer(task, seller, amountCents, opts);
  }
  inspect(task: TaskRow) { return this.for(task.payment_mode).inspect(task); }
  payoutOnboarding(agent: { id: string; stripe_account_id: string | null }, opts?: { includeLink?: boolean }) { return this.configured.payoutOnboarding(agent, opts); }

  /** Settlement must use the stored rail; configuration errors must not select a different rail. */
  for(mode: PaymentMode): PaymentProvider {
    const cached = this.byMode.get(mode);
    if (cached) return cached;
    let p: PaymentProvider;
    try {
      p = buildProvider(mode, this.e);
    } catch {
      throw new MarketplaceError("PAYMENT_FAILED", `This server cannot settle ${mode} tasks with its current configuration.`, {
        next_action: "Configure the task's payment rail on this server, then retry the same operation.",
      });
    }
    this.byMode.set(mode, p);
    return p;
  }
}

function buildProvider(mode: PaymentMode, e: { STRIPE_SECRET_KEY?: string | undefined; STRIPE_PROFILE_ID?: string | undefined; baseUrl: string }): PaymentProvider {
  switch (mode) {
    case "mock":
      return new MockProvider();
    case "card":
      return new StripeCardProvider(e.STRIPE_SECRET_KEY);
    case "mpp":
      // Defined in mpp.ts (Computer D). payments.ts ↔ mpp.ts import each other;
      // that is safe because neither touches the other's exports at module top level.
      return new StripeMppProvider(e.STRIPE_SECRET_KEY, e.STRIPE_PROFILE_ID, e.baseUrl);
  }
}

let provider: RoutingProvider | undefined;

export function payments(): PaymentProvider {
  if (provider) return provider;
  const e = env();
  provider = new RoutingProvider(buildProvider(e.PAYMENT_MODE, e), e);
  console.log(`[payments] mode=${provider.mode}: ${provider.label}`);
  return provider;
}

/** The MPP provider when this server can run one (needs STRIPE_PROFILE_ID), whatever PAYMENT_MODE is. */
export function mppProvider(): StripeMppProvider | null {
  payments();
  try {
    const p = provider!.for("mpp");
    return p instanceof StripeMppProvider ? p : null;
  } catch { return null; }
}
