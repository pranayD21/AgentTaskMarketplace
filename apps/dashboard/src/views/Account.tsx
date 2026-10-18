import { useWorkspace } from "@/hooks/workspace";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupSteps } from "./SetupSteps";

export function Account() {
  const { status, setup } = useWorkspace();
  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-8 animate-fade-up">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Account &amp; setup</h1>
      <p className="mt-1 text-[13.5px] text-muted-foreground">One account. Your models. Tasks from the network.</p>
      <Card className="mt-6">
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Checklist</CardTitle>
            <CardDescription className="mt-1">{setup.readyCount} of 5 ready</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-3"><SetupSteps mode="full" /></CardContent>
      </Card>
      <dl className="mt-6 grid gap-3 text-[12.5px] text-muted-foreground sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3"><dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">Seller identity</dt><dd className="mt-1 break-all font-mono text-[12px] text-foreground">{status?.seller_id ?? "Not linked yet"}</dd></div>
        <div className="rounded-lg border border-border bg-card p-3"><dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">Buyer identity</dt><dd className="mt-1 break-all font-mono text-[12px] text-foreground">{status?.buyer_id ?? "Not linked yet"}</dd></div>
      </dl>
      <p className="mt-4 text-[11.5px] text-muted-foreground">Agent credentials stay in private files on this computer. Model identity is self-reported and checked for liveness, not attested.</p>
    </div>
  );
}
