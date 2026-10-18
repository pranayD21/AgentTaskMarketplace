import { ExternalLink } from "lucide-react";
import { api, openHosted } from "@/lib/api";
import { PAYMENT_READY } from "@/lib/setup";
import { useWorkspace } from "@/hooks/workspace";
import { Button } from "@/components/ui/button";
import { Step, Steps } from "@/components/ui/stepper";

/** The account checklist. `entry` shows only what the workspace needs; `full` adds the seller steps. */
export function SetupSteps({ mode }: { mode: "entry" | "full" }) {
  const { setup, status, busy, act } = useWorkspace();
  const working = busy || setup.busy;

  const google = () => act(async () => { const { url } = await api.google(); window.location.assign(url); });
  const buying = () => act(() => openHosted("atm-buyer-payment", async () => {
    const r = await api.buyerPayment();
    if (!r.setup_url && !PAYMENT_READY.includes(r.buyer_payment_status ?? "")) throw new Error("Payment setup is unavailable. Please try again.");
    return r.setup_url;
  }));
  const prepare = () => act(() => api.prepare());
  const payouts = () => act(() => openHosted("atm-stripe", async () => {
    const r = await api.payout();
    if (!r.payout_onboarding_url && r.payout_status !== "ACTIVE") throw new Error("Stripe setup is unavailable. Please try again.");
    return r.payout_onboarding_url;
  }));
  const toggleSelling = () => act(() => (setup.selling ? api.stop() : api.start()));

  const current = !setup.chatLinked ? 1 : !setup.buyingReady ? 2 : !setup.modelPrepared ? 3 : !setup.payoutsReady ? 4 : 5;
  const full = mode === "full";
  return (
    <Steps>
      <Step index={1} title="Connect your Google account" detail={setup.googleDetail} done={setup.chatLinked} current={current === 1}
        action={<Button variant={setup.chatLinked ? "secondary" : "default"} disabled={working} onClick={() => void google()}>{setup.googleLabel}<ExternalLink className="size-3.5" aria-hidden /></Button>} />
      <Step index={2} title="Set up Stripe buying" detail={setup.buyingDetail} done={setup.buyingReady} current={current === 2} last={!full}
        action={<Button variant={setup.buyingReady ? "secondary" : current === 2 ? "default" : "secondary"} disabled={!setup.chatLinked || working} onClick={() => void buying()}>
          {setup.buyingReady ? "Buying connected" : "Set up buying"}{!setup.buyingReady && <ExternalLink className="size-3.5" aria-hidden />}</Button>} />
      {full && (
        <>
          <Step index={3} title="Prepare your local model" detail={setup.modelDetail} done={setup.modelPrepared} current={current === 3}
            action={<Button variant="secondary" disabled={working || !setup.signedIn || setup.selling} loading={setup.busy} onClick={() => void prepare()}>
              {setup.busy ? "Preparing" : setup.modelPrepared ? "Check model again" : "Prepare model"}</Button>} />
          <Step index={4} title="Set up Stripe selling payouts" detail={setup.payoutDetail} done={setup.payoutsReady} current={current === 4}
            action={<Button variant="secondary" disabled={working || !setup.signedIn || !setup.modelPrepared} onClick={() => void payouts()}>
              {setup.payoutsReady ? "Check Stripe status" : "Set up Stripe"}<ExternalLink className="size-3.5" aria-hidden /></Button>} />
          <Step index={5} title="Start accepting tasks" detail={setup.sellingDetail} done={setup.selling} current={current === 5} last
            action={<Button variant={setup.selling ? "secondary" : "default"} disabled={working || (!setup.selling && !setup.canStartSelling)} onClick={() => void toggleSelling()}>
              {setup.selling ? "Stop selling" : "Start selling"}</Button>} />
        </>
      )}
      {status?.phase && full && (
        <li className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-[12.5px] text-muted-foreground" role="status" aria-live="polite">
          <i className={`size-1.5 rounded-full ${setup.busy ? "bg-info animate-pulse" : "bg-muted-foreground/60"}`} aria-hidden />{status.phase}
        </li>
      )}
    </Steps>
  );
}
