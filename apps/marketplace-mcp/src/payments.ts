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

  constructor(secretKey: string) {
    if (!secretKey.startsWith("sk_test_")) {
      throw new Error("Refusing to start: STRIPE_SECRET_KEY is not a test-mode key (sk_test_...).");
    }
    this.stripe = new Stripe(secretKey, { appInfo: { name: "agent-task-marketplace", version: "0.1.0" } });
  }

  async onboardBuyer(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
    const customer = await this.stripe.customers.create({
      name: agent.display_name,
      description: `Buyer agent ${agent.id} (Agent Task Marketplace, test mode)`,
      metadata: { agent_id: agent.id, app: "agent-task-marketplace" },
    });
    // Stripe's shared test payment method; attaching clones it onto the customer.
    const pm = await this.stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
    await this.stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
    return { stripe_customer_id: customer.id, stripe_payment_method_id: pm.id };
  }

  async onboardSeller(agent: { id: string; display_name: string }): Promise<Partial<AgentRow>> {
    try {
      const account = await this.stripe.accounts.create({
        type: "custom",
        country: "US",
        email: `${agent.id}@example.com`,
        business_type: "individual",
        capabilities: { transfers: { requested: true } },
        tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
        business_profile: { mcc: "7372", product_description: "Agent compute (hackathon test account)", url: "https://example.com" },
        individual: { first_name: "Seller", last_name: agent.id.slice(-6), email: `${agent.id}@example.com` },
        metadata: { agent_id: agent.id, app: "agent-task-marketplace" },
      });
      return { stripe_account_id: account.id };
    } catch (err) {
      console.warn(`[stripe] connected account for ${agent.id} not created: ${(err as Error).message}`);
      return { stripe_account_id: null };
    }
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
    let note = `captured ${amountCents}c of the ${task.max_price_cents}c hold (${pi.id}); remainder released`;
    let transferId: string | null = null;
    if (seller?.stripe_account_id) {
      try {
        const transfer = await this.stripe.transfers.create({
          amount: amountCents,
          currency: "usd",
          destination: seller.stripe_account_id,
          transfer_group: task.id,
          ...(chargeId ? { source_transaction: chargeId } : {}),
          metadata: { task_id: task.id, seller_id: seller.id, app: "agent-task-marketplace" },
        });
        transferId = transfer.id;
        note += `; transferred to ${seller.stripe_account_id} (${transfer.id})`;
      } catch (err) {
        note += `; transfer PENDING_ONBOARDING: ${(err as Error).message}`;
      }
    } else {
      note += "; seller has no connected account (payout PENDING_ONBOARDING)";
    }
    return { payment_state: "CAPTURED", stripe_capture_id: chargeId, stripe_transfer_id: transferId, note };
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
      provider = new StripeCardProvider(e.STRIPE_SECRET_KEY!);
      break;
    case "mpp":
      throw new Error("PAYMENT_MODE=mpp is not wired yet; use card or mock");
  }
  console.log(`[payments] mode=${provider.mode}: ${provider.label}`);
  return provider;
}
