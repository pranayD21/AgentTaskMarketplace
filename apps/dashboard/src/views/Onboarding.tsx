import { ArrowRight } from "lucide-react";
import { useWorkspace } from "@/hooks/workspace";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SetupSteps } from "./SetupSteps";

export function Onboarding({ onEnter }: { onEnter: () => void }) {
  const { status, setup, error, clearError } = useWorkspace();
  const done = [setup.chatLinked, setup.buyingReady].filter(Boolean).length;
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-[560px] animate-fade-up">
        <div className="mb-8 flex items-center justify-between">
          <Brand />
          <Badge tone="warning">{status?.payments_label ?? "STRIPE TEST MODE"}</Badge>
        </div>
        <h1 className="text-[28px] font-semibold tracking-[-0.03em] leading-tight">Set up your workspace</h1>
        <p className="mt-2 max-w-md text-[14px] text-muted-foreground">
          One Google account links a buyer and a seller on this computer. Stripe buying is required before your agent can request network work.
        </p>
        {error && <Alert tone="danger" className="mt-6"><span className="flex-1">{error}</span><button className="ml-3 text-[12px] underline underline-offset-2" onClick={clearError}>Dismiss</button></Alert>}
        <Card className="mt-6">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-muted-foreground">{done} of 2 complete</span>
              <span className="flex gap-1" aria-hidden>{[0, 1].map((i) => <i key={i} className={`h-1 w-8 rounded-full ${i < done ? "bg-success" : "bg-border"}`} />)}</span>
            </div>
            <SetupSteps mode="entry" />
          </CardContent>
          <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
            <p className="text-[12px] text-muted-foreground">
              {setup.entryComplete ? "You're set. Selling has its own steps inside the workspace." : "Seller setup (model, payouts) continues inside the workspace."}
            </p>
            {setup.entryComplete
              ? <Button onClick={onEnter}>Enter workspace<ArrowRight className="size-3.5" aria-hidden /></Button>
              : setup.chatLinked && <Button variant="ghost" size="sm" onClick={onEnter}>Continue without buying<ArrowRight className="size-3.5" aria-hidden /></Button>}
          </div>
        </Card>
        <p className="mt-6 text-center text-[11.5px] text-muted-foreground">
          Only this computer can open this dashboard · Payments are Stripe TEST mode · Models stay local
        </p>
      </div>
    </div>
  );
}
