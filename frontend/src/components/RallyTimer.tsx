"use client";

import { useCallback, useEffect, useState } from "react";
import type { Room } from "@/lib/api";
import { clockCountdown, durationLabel, scheduleTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

const MINUTE_MS = 60_000;

export function RallyTimer({ room }: { room: Room }) {
  const { api } = useSession();
  // The room has no duration. Without the Rally record, windowEnd is the closest known end.
  const load = useCallback(() => api.getRally(room.rallyId), [api, room.rallyId]);
  const { data: rally, loaded } = usePolled(load);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  if (!loaded || now === null) return null;

  const start = new Date(room.meetAt).getTime();
  const end = rally ? start + rally.durationMin * MINUTE_MS : new Date(room.windowEnd).getTime();
  const counting = room.status === "formed";
  const live = now >= start && now < end;

  return (
    <div className="card" style={{ padding: "16px", display: "grid", gap: "12px" }}>
      {counting && (
        <div>
          <div className="mono">{now < start ? "Starts in" : live ? "Happening now · ends in" : "Time's up"}</div>
          {now < end && (
            <div role="timer" style={{ marginTop: "4px", fontFamily: "var(--font-mono), monospace", fontSize: "36px", fontWeight: 500, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", color: live ? "#315FE8" : "#1C1917" }}>
              {clockCountdown((now < start ? start : end) - now)}
            </div>
          )}
        </div>
      )}
      <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", margin: 0 }}>
        <div>
          <dt className="mono">Starts</dt>
          <dd style={{ margin: "4px 0 0", fontSize: "15px", fontWeight: 600 }}>{scheduleTime(start, now)}</dd>
        </div>
        <div>
          <dt className="mono">Ends</dt>
          <dd style={{ margin: "4px 0 0", fontSize: "15px", fontWeight: 600 }}>{scheduleTime(end, now)}</dd>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <dt className="mono">Time period</dt>
          <dd style={{ margin: "4px 0 0", fontSize: "15px", fontWeight: 600 }}>{durationLabel((end - start) / MINUTE_MS)}</dd>
        </div>
      </dl>
    </div>
  );
}
