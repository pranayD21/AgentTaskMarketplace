import { useMemo } from "react";
import { Power } from "lucide-react";
import { api } from "@/lib/api";
import { cn, gb } from "@/lib/utils";
import { useWorkspace } from "@/hooks/workspace";
import { useLiveView } from "@/hooks/live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LiveWorkspace } from "@/components/live-workspace";
import { SetupSteps } from "./SetupSteps";

/** Seller mode: one switch, the facts that matter, and the worker's current task as it happens. */
export function Seller({ onOpenAccount }: { onOpenAccount: () => void }) {
  const { status, setup, busy, act } = useWorkspace();
  const machine = status?.machine;
  const worker = status?.worker ?? {};
  const running = setup.selling;
  const toggle = () => act(() => (running ? api.stop() : api.start()));
  const live = useLiveView(running);

  // The model this computer sells with: what the worker registered, else the first installed model the network accepts.
  const model = useMemo(() => {
    const installed = (machine?.models ?? []).map((m) => m.name);
    const allowed = status?.allowed_models ?? [];
    return worker.models?.find((m) => installed.includes(m)) ?? installed.find((m) => allowed.includes(m)) ?? null;
  }, [machine, worker.models, status?.allowed_models]);
  const loaded = Boolean(model && machine?.loaded_models?.some((m) => m.name === model));

  return (
    <div className="scroll-thin h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1080px] px-6 py-6 animate-fade-up">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Seller</h1>
            <p className="text-[12px] text-muted-foreground">Lend this computer to the network. One sandboxed task at a time, using all of its compute.</p>
          </div>
          <Badge tone="outline">WASM SANDBOX · NOT A TEE</Badge>
        </header>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 p-5">
            <span className={cn("grid size-11 place-items-center rounded-xl border", running ? "border-success/40 bg-success-soft text-success" : "border-border bg-subtle text-muted-foreground")} aria-hidden>
              <Power className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Seller mode</h2>
                <Badge tone={running ? "success" : "muted"} dot={running}>{running ? "Watching for tasks" : "Stopped"}</Badge>
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {running ? "Your agent claims eligible work and runs it locally. It resumes after login." : setup.canStartSelling ? "Activate to accept network work. Nothing else to configure." : "Finish the seller checklist to activate."}
              </p>
            </div>
            <Button size="lg" variant={running ? "secondary" : "default"} disabled={busy || setup.busy || (!running && !setup.canStartSelling)} loading={busy} onClick={() => void toggle()}>
              {running ? "Stop seller mode" : "Activate seller mode"}
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border bg-subtle/50 px-5 py-3.5 text-[12.5px] md:grid-cols-4">
            <Fact label="This computer" value={machine?.chip ?? "—"} hint={machine ? `${machine.cpu_cores} cores · ${gb(machine.memory_bytes)}` : "Reading hardware"} />
            <Fact label="Local model" value={model ?? (machine ? "None installed" : "—")}
              hint={!model ? "Prepare model downloads Qwen3 8B." : loaded ? "Loaded in memory" : "Loads when work starts"} />
            <Fact label="Ollama" value={machine ? (machine.ollama_online ? "Connected" : "Offline") : "—"} tone={machine && !machine.ollama_online ? "danger" : undefined}
              hint={machine?.hostname ?? "—"} />
            <Fact label="Approved tasks" value={worker.approvals ?? "—"} hint={running ? "Worker running" : "Worker stopped"} />
          </dl>
          {!running && !setup.canStartSelling && (
            <div className="border-t border-border px-5 py-4">
              <SetupSteps mode="full" />
              <p className="mt-3 text-[12px] text-muted-foreground">Manage everything on the <button className="underline underline-offset-2" onClick={onOpenAccount}>account page</button>.</p>
            </div>
          )}
        </Card>

        <Card className="mt-4 overflow-hidden">
          <LiveWorkspace model={live.model} connection={live.connection} running={running} />
        </Card>

        <p className="mt-6 text-center text-[11.5px] text-muted-foreground">Only this computer can open this dashboard · Prompts and output are visible here because the sandbox is observed on this machine · Model identity is self-reported, not attested.</p>
      </div>
    </div>
  );
}

function Fact({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "danger" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-medium", tone === "danger" && "text-danger")}>{value}</dd>
      {hint && <dd className="truncate text-[11.5px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
