import { useCallback, useEffect, useState } from "react";
import { fetchMarket, type MarketData } from "./market";
import { Dashboard, dashboardUrl, type DashboardData } from "./data";

export function useDashboard(base: string) {
  const [data, setData] = useState<DashboardData>();
  const [market, setMarket] = useState<MarketData>();
  const [error, setError] = useState<string>();
  const [updated, setUpdated] = useState<number>();
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry((v) => v + 1), []);
  useEffect(() => {
    let stopped = false;
    let marketUpdated = 0;
    setMarket(undefined);
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    async function poll() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const marketRequest = Date.now() - marketUpdated >= 30000
          ? fetchMarket(base, controller.signal).then(value => { if (!stopped) setMarket(value); marketUpdated = Date.now(); }).catch(() => { if (!stopped) setMarket(undefined); marketUpdated = Date.now(); })
          : Promise.resolve();
        const response = await fetch(dashboardUrl(base), {
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        });
        if (!response.ok) throw new Error("Dashboard unavailable");
        const parsed = Dashboard.safeParse(await response.json());
        if (!parsed.success) throw new Error("Invalid dashboard");
        await marketRequest;
        if (!stopped) {
          setData(parsed.data);
          setError(undefined);
          setUpdated(Date.now());
        }
      } catch {
        if (!stopped)
          setError(
            "Cannot refresh the marketplace. Check the API URL and server connection.",
          );
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [base, retry]);
  return { data, market, error, updated, refresh };
}
