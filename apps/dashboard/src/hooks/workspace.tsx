import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Status } from "@/lib/api";
import { deriveSetup, type SetupState } from "@/lib/setup";

export interface Sample { at: number; load: number; free: number }

interface Workspace {
  status: Status | undefined;
  setup: SetupState;
  samples: Sample[];
  error: string | undefined;
  clearError: () => void;
  busy: boolean;
  refresh: () => Promise<void>;
  /** Runs an action with the busy flag, surfaces errors, and refreshes status afterwards. */
  act: (fn: () => Promise<unknown>) => Promise<boolean>;
}

const Ctx = createContext<Workspace | null>(null);
const STATUS_INTERVAL = 5000;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const inflight = useRef(false);
  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const next = await api.status();
      setStatus(next);
      setSamples((s) => [...s, { at: Date.now(), load: Number(next.machine?.load_average_1m ?? 0), free: Number(next.machine?.free_memory_bytes ?? 0) }].slice(-72));
      setError(next.error ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot reach the local dashboard.");
    } finally { inflight.current = false; }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, STATUS_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(undefined);
    try { await fn(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "The request could not finish."); return false; }
    finally { setBusy(false); void refresh(); }
  }, [refresh]);
  const setup = useMemo(() => deriveSetup(status), [status]);
  const value = useMemo<Workspace>(() => ({ status, setup, samples, error, clearError: () => setError(undefined), busy, refresh, act }),
    [status, setup, samples, error, busy, refresh, act]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
