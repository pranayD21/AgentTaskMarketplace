import { useEffect, useRef, useState } from "react";
import { apply, createModel, type LiveModel } from "@/lib/live";

export type LiveConnection = "idle" | "connecting" | "open" | "closed";
export interface LiveSnapshot { model: LiveModel; connection: LiveConnection; tick: number }

/**
 * Subscribes to the daemon's relay of the worker's live view while selling.
 * The stream replays history on every (re)connect, so the model is rebuilt
 * from scratch each time and always lands on the current instance and run.
 */
export function useLiveView(enabled: boolean): LiveSnapshot {
  const model = useRef<LiveModel>(createModel());
  const [snap, setSnap] = useState<LiveSnapshot>({ model: model.current, connection: "idle", tick: 0 });
  useEffect(() => {
    model.current = createModel();
    if (!enabled) { setSnap({ model: model.current, connection: "idle", tick: 0 }); return; }
    let source: EventSource | undefined, retry: ReturnType<typeof setTimeout> | undefined, frame = 0, stopped = false, resetOnNext = false, tick = 0;
    let connection: LiveConnection = "connecting";
    const flush = () => { frame = 0; if (!stopped) setSnap({ model: model.current, connection, tick: ++tick }); };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(flush); };
    const connect = () => {
      if (stopped) return;
      connection = "connecting"; schedule();
      source = new EventSource("/api/live");
      source.onopen = () => { connection = "open"; schedule(); };
      source.onmessage = (message) => {
        if (resetOnNext) { resetOnNext = false; model.current = createModel(); }
        try { apply(model.current, JSON.parse(message.data)); } catch { /* malformed frame */ }
        schedule();
      };
      source.onerror = () => {
        // The relay answers 503 until the worker reports its viewer; keep trying.
        connection = "closed"; source?.close(); resetOnNext = true; schedule();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    const clock = setInterval(schedule, 1000);
    return () => { stopped = true; source?.close(); clearTimeout(retry); clearInterval(clock); if (frame) cancelAnimationFrame(frame); };
  }, [enabled]);
  return snap;
}
