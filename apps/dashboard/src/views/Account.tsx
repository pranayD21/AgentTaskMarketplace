import { useMemo } from "react";
import { useWorkspace } from "@/hooks/workspace";
import { useLocalSetting } from "@/hooks/useChat";
import { defaultModel } from "@/lib/setup";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { SetupSteps } from "./SetupSteps";

export function Account() {
  const { status, setup } = useWorkspace();
  const [model, setModel] = useLocalSetting("atm-chat-model", "");
  const names = useMemo(() => (status?.machine?.models ?? []).map((m) => m.name), [status]);
  const selected = defaultModel(names, model);
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
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Chat model</CardTitle>
          <CardDescription className="mt-1">The local Ollama model that plans your requests and decides what to delegate. It needs tool calling; Qwen3 is the default when installed.</CardDescription>
        </CardHeader>
        <CardContent className="pt-1">
          <Label htmlFor="chat-model">Local model</Label>
          <Select id="chat-model" className="mt-1.5 max-w-xs" value={selected} disabled={!names.length} onChange={(e) => setModel(e.target.value)}>
            {names.length ? names.map((n) => <option key={n} value={n}>{n}</option>) : <option value="">No local models installed</option>}
          </Select>
          <p className="mt-2 text-[12px] text-muted-foreground">Each request may post up to four network tasks at 50–100 TEST cents, 200 at most. Account and shared provider limits also apply.</p>
        </CardContent>
      </Card>
      <dl className="mt-6 grid gap-3 text-[12.5px] text-muted-foreground sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3"><dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">Seller identity</dt><dd className="mt-1 break-all font-mono text-[12px] text-foreground">{status?.seller_id ?? "Not linked yet"}</dd></div>
        <div className="rounded-lg border border-border bg-card p-3"><dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">Buyer identity</dt><dd className="mt-1 break-all font-mono text-[12px] text-foreground">{status?.buyer_id ?? "Not linked yet"}</dd></div>
      </dl>
      <p className="mt-4 text-[11.5px] text-muted-foreground">Agent credentials stay in private files on this computer. Model identity is self-reported and checked for liveness, not attested.</p>
    </div>
  );
}
