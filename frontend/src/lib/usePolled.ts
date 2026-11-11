"use client";

import { useCallback, useEffect, useState } from "react";

type Polled<T> = { data: T | null; error: unknown; loaded: boolean };

// Loads once, then every pollMs while the tab is visible. There is no push or SSE
// yet; the handoff asks for 10 to 15 seconds and no faster. Pass a stable `load`
// (useCallback), or null to wait.
export function usePolled<T>(load: (() => Promise<T>) | null, pollMs?: number) {
  const [state, setState] = useState<Polled<T>>({ data: null, error: null, loaded: false });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!load) return;
    let alive = true;
    let inFlight = false;
    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await load();
        if (alive) setState({ data, error: null, loaded: true });
      } catch (error: unknown) {
        if (alive) setState(prev => ({ ...prev, error, loaded: true }));
      } finally {
        inFlight = false;
      }
    };
    run();
    const timer = pollMs
      ? setInterval(() => {
          if (!document.hidden) run();
        }, pollMs)
      : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [load, pollMs, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const setData = useCallback((data: T) => setState({ data, error: null, loaded: true }), []);

  return { ...state, refresh, setData };
}
