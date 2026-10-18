import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Run } from "@/lib/api";

const CHAT_INTERVAL = 3000;

/** Polls the daemon's chat history while the account is linked. Keeps the last good snapshot on transient failures. */
export function useChat(enabled: boolean) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inflight = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || inflight.current) return;
    inflight.current = true;
    try { const { runs } = await api.chat(); setRuns(runs ?? []); setLoaded(true); }
    catch { /* keep previous */ }
    finally { inflight.current = false; }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, CHAT_INTERVAL);
    return () => clearInterval(timer);
  }, [enabled, refresh]);
  return { runs, loaded, refresh };
}

export function useLocalSetting(key: string, initial: string) {
  // The first value is persisted too, so a generated conversation id survives a reload.
  const [value, setValue] = useState(() => {
    try { const saved = localStorage.getItem(key); if (saved) return saved; localStorage.setItem(key, initial); } catch { /* private mode */ }
    return initial;
  });
  const update = useCallback((next: string) => { setValue(next); try { localStorage.setItem(key, next); } catch { /* private mode */ } }, [key]);
  return [value, update] as const;
}

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
