import { useMemo, type ReactNode } from "react";
import { Power } from "lucide-react";
import { api, type Status } from "@/lib/api";
import { cn, gb } from "@/lib/utils";
import { useWorkspace, type Sample } from "@/hooks/workspace";
import { useLiveView } from "@/hooks/live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { AreaChart } from "@/components/ui/area-chart";
import { fmtClock, type LiveModel } from "@/lib/live";
import { LiveWorkspace } from "@/components/live-workspace";
import { SetupSteps } from "./SetupSteps";

/** Seller mode: one switch, the facts that matter, and the worker's current task as it happens. */
export function Seller({ onOpenAccount }: { onOpenAccount: () => void }) {
  const { status, setup, samples, busy, act } = useWorkspace();
  const machine = status?.machine;
  const worker = status?.worker ?? {};
  const running = setup.selling;
  const suspended = worker.seller_status === "SUSPENDED";
  // Why the worker cannot take tasks right now, if the service is on but idle for a known reason.
  const blocked = suspended ? "SELLER_SUSPENDED" : running && worker.stopped_reason ? worker.stopped_reason : undefined;
  const toggle = () => act(() => (running ? api.stop() : api.start()));
  const live = useLiveView(running);

  // Models this computer can sell with: installed, and accepted by the network's allowlist.
  const sellable = useMemo(() => (machine?.models ?? []).map((m) => m.name).filter((m) => (status?.allowed_models ?? []).includes(m)), [machine, status?.allowed_models]);
  // The chosen model, else what the worker registered, else the first sellable one.
  const model = status?.seller_model || worker.models?.find((m) => sellable.includes(m)) || sellable[0] || null;
  const loaded = Boolean(model && machine?.loaded_models?.some((m) => m.name === model));
  const chooseModel = (value: string) => void act(() => api.sellerModel(value));

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
                <Badge tone={suspended ? "danger" : running ? "success" : "muted"} dot={running && !suspended}>{suspended ? "Suspended" : running ? "Watching for tasks" : "Stopped"}</Badge>
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {suspended ? `The marketplace suspended this seller after a rejected result${worker.strikes ? ` (${worker.strikes} strike${worker.strikes === 1 ? "" : "s"})` : ""}. The operator must lift it; your worker retries on its own.`
                  : running ? "Your agent claims eligible work and runs it locally. It resumes after login." : setup.canStartSelling ? "Activate to accept network work. Nothing else to configure." : "Finish the seller checklist to activate."}
              </p>
            </div>
            <Button size="lg" variant={running ? "secondary" : "default"} disabled={busy || setup.busy || (!running && !setup.canStartSelling)} loading={busy} onClick={() => void toggle()}>
              {running ? "Stop seller mode" : "Activate seller mode"}
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border bg-subtle/50 px-5 py-3.5 text-[12.5px] md:grid-cols-4">
            <Fact label="This computer" value={machine?.chip ?? "—"} hint={machine ? `${machine.cpu_cores} cores · ${gb(machine.memory_bytes)}` : "Reading hardware"} />
            <div className="min-w-0">
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Local model</dt>
              <dd className="mt-0.5">
                <Select aria-label="Seller model" className="h-7 text-[12.5px]" value={status?.seller_model ?? ""} disabled={running || busy || !sellable.length} onChange={(e) => chooseModel(e.target.value)}>
                  <option value="">{sellable.length ? `Any accepted (${sellable.length})` : machine ? "None installed" : "—"}</option>
                  {sellable.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </dd>
              <dd className="truncate text-[11.5px] text-muted-foreground">{running ? "Stop selling to change" : !model ? "Prepare model downloads Qwen3 8B." : loaded ? `${model} · loaded in memory` : `${model} · loads when work starts`}</dd>
            </div>
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

        <ComputeCard machine={machine} samples={samples} vm={live.model.vm} running={running} />

        <Card className="mt-4 overflow-hidden">
          <LiveWorkspace model={live.model} connection={live.connection} running={running} blocked={blocked} />
        </Card>

        <p className="mt-6 text-center text-[11.5px] text-muted-foreground">Only this computer can open this dashboard · Prompts and output are visible here because the sandbox is observed on this machine · Model identity is self-reported, not attested.</p>
      </div>
    </div>
  );
}

/** Four live graphs: the whole computer (sampled by the dashboard) and the sandbox process (reported by the worker). */
function ComputeCard({ machine, samples, vm, running }: { machine: Status["machine"] | undefined; samples: Sample[]; vm: LiveModel["vm"]; running: boolean }) {
  const totalGb = (machine?.memory_bytes ?? 0) / 1024 ** 3;
  const cores = machine?.cpu_cores ?? 1;
  const load = samples.map((s) => s.load), free = samples.map((s) => s.free / 1024 ** 3);
  const cpu = running ? vm?.cpu ?? [] : [], rss = running ? (vm?.rss ?? []).map((b) => b / 1048576) : [];
  const up = vm ? (vm.closedAt ?? Date.now()) - vm.startedAt : 0;
  const tone = !running || !vm ? "muted" : vm.state === "crashed" ? "danger" : vm.state === "busy" ? "info" : vm.state === "ready" ? "success" : "muted";
  const idle = !running ? "Sandbox starts with seller mode" : !vm ? "Sandbox not started yet" : vm.closedAt ? "Sandbox closed" : undefined;
  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Compute</h2>
        <Badge tone={tone} dot={running && (vm?.state === "busy" || vm?.state === "ready")}>{running && vm && !vm.closedAt ? `Sandbox · ${vm.state}` : "Sandbox off"}</Badge>
        {running && vm && !vm.closedAt && <span className="font-mono text-[11.5px] text-muted-foreground">{vm.id}{vm.pid ? ` · pid ${vm.pid}` : ""} · up {fmtClock(up)}{vm.version ? ` · wassette ${vm.version}` : ""}</span>}
        <span className="ml-auto text-[11.5px] text-muted-foreground">Sampled every 5 s · sandbox every 1 s</span>
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Graph title="System load" hint={`1-minute average · ${cores} cores`} value={load.at(-1)?.toFixed(2)} values={load} max={Math.max(cores, ...load)} className="text-info" />
        <Graph title="Free memory" hint={`of ${totalGb ? `${totalGb.toFixed(0)} GB` : "—"}`} value={free.at(-1) !== undefined ? `${free.at(-1)!.toFixed(1)} GB` : undefined} values={free} max={totalGb || undefined} className="text-success" format={(v) => `${v.toFixed(1)} GB`} />
        <Graph title="Sandbox CPU" hint="Wasm process · one core = 100%" value={cpu.at(-1) !== undefined ? `${cpu.at(-1)!.toFixed(0)}%` : undefined} values={cpu} max={Math.max(100, ...cpu)} className="text-foreground" format={(v) => `${v.toFixed(0)}%`} empty={idle} />
        <Graph title="Sandbox memory" hint="Resident set of the Wasm process" value={rss.at(-1) !== undefined ? `${rss.at(-1)!.toFixed(0)} MB` : undefined} values={rss} className="text-muted-foreground" format={(v) => `${v.toFixed(0)} MB`} empty={idle} />
      </div>
    </Card>
  );
}

function Graph({ title, hint, value, values, max, className, format, empty }: { title: string; hint: string; value?: string; values: number[]; max?: number; className?: string; format?: (v: number) => string; empty?: string }) {
  return (
    <div className="bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="whitespace-nowrap text-[12.5px] font-semibold">{title}</div><div className="truncate text-[11px] text-muted-foreground">{hint}</div></div>
        <strong className="whitespace-nowrap text-[17px] font-semibold tracking-[-0.02em]">{value ?? "—"}</strong>
      </div>
      <AreaChart values={values} max={max} className={cn("mt-3 h-[64px]", className)} label={title} format={format} empty={empty ?? "Collecting samples…"} />
    </div>
  );
}

function Fact({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-medium", tone === "danger" && "text-danger")}>{value}</dd>
      {hint && <dd className="truncate text-[11.5px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
