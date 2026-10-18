import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, ExternalLink, Power } from "lucide-react";
import { api, type Compute } from "@/lib/api";
import { cn, gb } from "@/lib/utils";
import { useWorkspace } from "@/hooks/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Stat } from "@/components/ui/stat";
import { AreaChart } from "@/components/ui/area-chart";
import { Table, TD, TH } from "@/components/ui/table";
import { SetupSteps } from "./SetupSteps";

export function Seller({ onOpenAccount }: { onOpenAccount: () => void }) {
  const { status, setup, samples, busy, act } = useWorkspace();
  const machine = status?.machine;
  const worker = status?.worker ?? {};
  const running = setup.selling;
  const toggle = () => act(() => (running ? api.stop() : api.start()));
  const loaded = useMemo(() => new Set((machine?.loaded_models ?? []).map((m) => m.name)), [machine]);
  const viewer = worker.viewer_url && /^http:\/\/(localhost|127\.0\.0\.1):[0-9]+\/?$/.test(worker.viewer_url) && running ? worker.viewer_url : null;
  const totalGb = (machine?.memory_bytes ?? 0) / 1024 ** 3;

  return (
    <div className="scroll-thin h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1080px] px-6 py-6 animate-fade-up">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Seller</h1>
            <p className="text-[12px] text-muted-foreground">Your compute, at work. One sandboxed task at a time.</p>
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
                {running ? "Your agent claims eligible work and runs it locally. It resumes after login." : setup.canStartSelling ? "Set your allocation below, then activate to accept network work." : "Finish the seller checklist to activate."}
              </p>
            </div>
            <Button size="lg" variant={running ? "secondary" : "default"} disabled={busy || setup.busy || (!running && !setup.canStartSelling)} loading={busy} onClick={() => void toggle()}>
              {running ? "Stop seller mode" : "Activate seller mode"}
            </Button>
          </div>
          {!running && !setup.canStartSelling && (
            <div className="border-t border-border bg-subtle/50 px-5 py-4">
              <SetupSteps mode="full" />
              <p className="mt-3 text-[12px] text-muted-foreground">Manage everything on the <button className="underline underline-offset-2" onClick={onOpenAccount}>account page</button>.</p>
            </div>
          )}
        </Card>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Your computer" value={machine?.chip ?? "—"} hint={machine?.hostname ?? "Reading hardware"} />
          <Stat label="CPU cores" value={machine?.cpu_cores ?? "—"} hint={machine ? `1-minute load ${Number(machine.load_average_1m).toFixed(2)}` : "—"} />
          <Stat label="Unified memory" value={machine ? gb(machine.memory_bytes) : "—"} hint={machine ? `${gb(machine.free_memory_bytes)} free` : "—"} />
          <Stat label="Approved tasks" value={worker.approvals ?? "—"} hint={running ? "Worker running" : "Worker stopped"} />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <ChartCard title="System load" description="1-minute average, sampled every 5 s" value={samples.at(-1)?.load.toFixed(2)} values={samples.map((s) => s.load)} max={Math.max(machine?.cpu_cores ?? 1, ...samples.map((s) => s.load))} className="text-info" />
          <ChartCard title="Free memory" description="Physical memory not in use" value={samples.at(-1) ? gb(samples.at(-1)!.free) : undefined} values={samples.map((s) => s.free / 1024 ** 3)} max={totalGb || undefined} className="text-success" format={(v) => `${v.toFixed(1)} GB`} />
        </div>

        <ComputeCard disabled={running || busy} />

        <Card className="mt-3">
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>Local models</CardTitle><CardDescription className="mt-1">Installed in Ollama on {machine?.hostname ?? "this computer"}.</CardDescription></div>
            <Badge tone={machine?.ollama_online ? "success" : "danger"} dot>{machine?.ollama_online ? "Ollama connected" : "Ollama offline"}</Badge>
          </CardHeader>
          <Table>
            <thead><tr><TH>Model</TH><TH>Parameters</TH><TH>Disk size</TH><TH>Status</TH></tr></thead>
            <tbody>
              {machine?.models?.length ? machine.models.map((m) => {
                const state = loaded.has(m.name) ? "loaded" : status?.allowed_models.includes(m.name) ? "ready" : "unsupported";
                return (
                  <tr key={m.name}>
                    <TD><div className="font-medium">{m.name}</div><div className="text-[11px] text-muted-foreground">{m.quantization || "Local model"}</div></TD>
                    <TD className="text-muted-foreground">{m.parameters || "—"}</TD>
                    <TD className="text-muted-foreground">{gb(m.size)}</TD>
                    <TD><Badge tone={state === "loaded" ? "success" : state === "ready" ? "info" : "muted"}>{state === "loaded" ? "Loaded in memory" : state === "ready" ? "Ready to prepare" : "Not supported yet"}</Badge></TD>
                  </tr>
                );
              }) : <tr><TD colSpan={4} className="py-8 text-center text-muted-foreground">{machine ? "No models installed yet. Prepare model downloads Qwen3 8B for you." : "Looking for installed models…"}</TD></tr>}
            </tbody>
          </Table>
          <p className="px-5 py-3 text-[11.5px] text-muted-foreground">
            {machine?.loaded_models?.length ? machine.loaded_models.map((m) => `${m.name}: ${gb(m.size_vram)} reported GPU memory`).join(" · ") : "No model is currently loaded in memory. Models load when work starts."}
          </p>
        </Card>

        <Card className="mt-3 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>Live agent workspace</CardTitle><CardDescription className="mt-1">Prompts, model reasoning, tools and output from your current worker.</CardDescription></div>
            {viewer && <a className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground" href={viewer} target="_blank" rel="noopener">Open<ExternalLink className="size-3" aria-hidden /></a>}
          </CardHeader>
          {viewer ? <iframe title="Live seller agent workspace" src={viewer} className="block h-[640px] w-full border-t border-border" />
            : <CardContent className="flex items-center gap-2 pb-5 text-[13px] text-muted-foreground"><Activity className="size-4" aria-hidden />{running ? "Waiting for the worker to report its viewer." : "Activate seller mode to open your agent workspace."}</CardContent>}
        </Card>
        <p className="mt-6 text-center text-[11.5px] text-muted-foreground">Only this computer can open this dashboard · Model identity is self-reported and checked for liveness, not attested.</p>
      </div>
    </div>
  );
}

function ChartCard({ title, description, value, values, max, className, format }: { title: string; description: string; value?: string; values: number[]; max?: number; className?: string; format?: (v: number) => string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-[13px] font-semibold">{title}</div><div className="text-[11.5px] text-muted-foreground">{description}</div></div>
        <strong className="text-[18px] font-semibold tracking-[-0.02em]">{value ?? "—"}</strong>
      </div>
      <AreaChart values={values} max={max} className={cn("mt-3 h-[72px]", className)} label={title} format={format} />
    </Card>
  );
}

function ComputeCard({ disabled }: { disabled: boolean }) {
  const { status, act, busy } = useWorkspace();
  const [settings, setSettings] = useState<Compute>();
  const [saved, setSaved] = useState(false);
  useEffect(() => { let on = true; api.compute().then((c) => { if (on) setSettings(c); }).catch(() => {}); return () => { on = false; }; }, []);
  const eligible = (status?.machine?.models ?? []).filter((m) => status?.allowed_models.includes(m.name)).map((m) => m.name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    void act(async () => { setSettings(await api.saveCompute(settings)); setSaved(true); setTimeout(() => setSaved(false), 2000); });
  };
  const update = (patch: Partial<Compute>) => setSettings((s) => (s ? { ...s, ...patch } : s));
  const running = status?.worker?.service === "running";
  return (
    <Card className="mt-3">
      <CardHeader className="flex-row items-start justify-between">
        <div><CardTitle>Compute allocation</CardTitle><CardDescription className="mt-1">Settings apply when you start selling. Stop selling before changing them.</CardDescription></div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label htmlFor="compute-model">Seller model</Label>
            <Select id="compute-model" className="mt-1.5" value={settings?.model ?? ""} disabled={disabled || !settings} onChange={(e) => update({ model: e.target.value })}>
              <option value="">All supported models</option>{eligible.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select></div>
          <div><Label htmlFor="compute-threads">CPU threads</Label>
            <Input id="compute-threads" className="mt-1.5" type="number" min={1} max={status?.machine?.cpu_cores ?? 64} value={settings?.cpu_threads ?? ""} disabled={disabled || !settings} onChange={(e) => update({ cpu_threads: Number(e.target.value) })} /></div>
          <div><Label htmlFor="compute-context">Context tokens</Label>
            <Select id="compute-context" className="mt-1.5" value={String(settings?.context_tokens ?? 8192)} disabled={disabled || !settings} onChange={(e) => update({ context_tokens: Number(e.target.value) })}>
              {[2048, 4096, 8192, 16384].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
            </Select></div>
          <div><Label htmlFor="compute-memory">Max model size (GB)</Label>
            <Input id="compute-memory" className="mt-1.5" type="number" min={1} step={0.5} value={settings?.max_model_gb ?? ""} disabled={disabled || !settings} onChange={(e) => update({ max_model_gb: Number(e.target.value) })} /></div>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
            <Button type="submit" variant="secondary" disabled={disabled || !settings} loading={busy}>{saved ? "Saved" : "Save allocation"}</Button>
            <span className="text-[12px] text-muted-foreground">{running ? "Stop selling before changing allocation." : "CPU threads and context go to Ollama. Model size limits admission; it does not reserve RAM or cap GPU use."}</span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
