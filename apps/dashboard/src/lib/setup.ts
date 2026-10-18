import type { Status } from "./api";

export const PAYMENT_READY = ["READY", "MOCK"];

export interface SetupState {
  signedIn: boolean;        // Google owner present
  chatLinked: boolean;      // buyer identity exists for this owner (older sellers need one more sign-in)
  buyingReady: boolean;     // Stripe buying set up (or MOCK)
  modelPrepared: boolean;
  payoutsReady: boolean;
  selling: boolean;
  busy: boolean;
  email: string;
  /** Required before the workspace is useful: Google + buyer link + Stripe buying. */
  entryComplete: boolean;
  readyCount: number;
  canSend: boolean;
  canStartSelling: boolean;
  googleLabel: string;
  googleDetail: string;
  buyingDetail: string;
  modelDetail: string;
  payoutDetail: string;
  sellingDetail: string;
  chatNotice: string;
}

export function deriveSetup(status: Status | undefined): SetupState {
  const owner = status?.owner ?? null;
  const worker = status?.worker ?? {};
  const signedIn = Boolean(owner);
  const chatLinked = signedIn && Boolean(status?.buyer_id);
  const buyingReady = PAYMENT_READY.includes(status?.buyer_payment?.buyer_payment_status ?? "");
  const modelPrepared = Boolean(worker.prepared);
  const payoutsReady = worker.payout_status === "ACTIVE";
  const selling = worker.service === "running";
  const busy = Boolean(status?.busy);
  const models = status?.machine?.models?.length ?? 0;
  const email = owner?.email ?? "";
  return {
    signedIn, chatLinked, buyingReady, modelPrepared, payoutsReady, selling, busy, email,
    entryComplete: chatLinked && buyingReady,
    readyCount: [signedIn, buyingReady, modelPrepared, payoutsReady, selling].filter(Boolean).length,
    canSend: chatLinked && buyingReady && models > 0,
    canStartSelling: signedIn && modelPrepared && payoutsReady && buyingReady && !busy,
    googleLabel: signedIn && !chatLinked ? "Enable chat with Google" : signedIn ? "Sign in again" : "Continue with Google",
    googleDetail: signedIn && !chatLinked
      ? `Signed in as ${email}. Sign in once more to enable chat and buying for this existing account.`
      : signedIn ? `Signed in as ${email}` : "One Google login connects buying and selling.",
    buyingDetail: buyingReady
      ? "Stripe buying is connected. Your payment method is saved with Stripe."
      : !chatLinked ? "Connect your Google account first, then complete Stripe buying."
      : "Required: complete Stripe’s hosted buying setup to unlock requests and new seller starts.",
    modelDetail: modelPrepared
      ? "Local model passed its liveness check in the Wasm sandbox."
      : "Uses a supported installed model, or downloads Qwen3 8B (about 5.2 GB).",
    payoutDetail: payoutsReady
      ? "Stripe test transfer capability is active. This does not confirm a real bank payout."
      : modelPrepared ? "Complete Stripe’s hosted payout setup for this seller account."
      : "Prepare your model to create your Stripe payout account.",
    sellingDetail: selling
      ? "Your agent is watching for matching tasks. It resumes after login."
      : "Complete Stripe buying, model setup and selling payouts before starting.",
    chatNotice: !chatLinked
      ? (signedIn ? "Your seller login needs one upgrade. Select Enable chat with Google; your worker can keep running." : "Continue with Google to start.")
      : !models ? "Install a local Ollama model to chat."
      : !buyingReady ? "Complete required Stripe buying setup to unlock Send request."
      : "Your model chooses whether to delegate. Network offers: 50–100 TEST cents each, at most 200 per request. Acceptance checks completion format, not answer correctness.",
  };
}

export const defaultModel = (names: string[], previous?: string) =>
  previous && names.includes(previous) ? previous : names.includes("qwen3:8b") ? "qwen3:8b" : names[0] ?? "";
