import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api, type Run } from "@/lib/api";
import { tasks } from "@/lib/chat";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { TaskCard } from "@/components/task-card";

export function TaskViewer() {
  const taskId = new URLSearchParams(location.search).get("task") ?? "";
  const [run, setRun] = useState<Run>();
  const [note, setNote] = useState("Connecting…");
  useEffect(() => {
    let on = true, loading = false;
    async function tick() {
      if (loading) return; loading = true;
      try {
        const { runs } = await api.chat();
        const found = runs.find((r) => r.task_ids.includes(taskId));
        if (!on) return;
        if (!found) { setNote("This task is not in the signed-in account’s local history."); return; }
        setRun(found); setNote("Live · updates every 3 seconds");
      } catch (e) { if (on) setNote(e instanceof Error ? e.message : "Connection interrupted; retrying."); }
      finally { loading = false; }
    }
    void tick();
    const timer = setInterval(() => { void tick(); }, 3000);
    return () => { on = false; clearInterval(timer); };
  }, [taskId]);
  const task = useMemo(() => (run ? tasks(run).find((t) => t.task_id === taskId) : undefined), [run, taskId]);
  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-8">
      <header className="flex items-center justify-between gap-3">
        <a href="/" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden />Workspace</a>
        <Brand compact />
      </header>
      <h1 className="mt-8 text-[22px] font-semibold tracking-[-0.02em]">Task progress &amp; output</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">Live marketplace status from the remote worker. Its sandbox, CPU and token viewer opens on the seller’s computer, not here.</p>
      <p className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground" role="status"><Badge tone={run ? "success" : "muted"} dot={Boolean(run)}>{note}</Badge></p>
      {task && <TaskCard task={task} showViewerLink={false} className="mt-5" />}
    </div>
  );
}
