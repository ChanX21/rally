"use client";

import { useCallback } from "react";
import type { AiRequest } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

const labels: Record<string, string> = { onboarding: "Onboarding questions", intent: "Rally planning", composition: "Matchmaking", map_dialogue: "Map dialogue", proof: "Photo check" };

export function AiRequests({ requests }: { requests: readonly AiRequest[] }) {
  const unique = requests.filter((request, index) => request.requestId && requests.findIndex((other) => other.requestId === request.requestId) === index);
  if (!unique.length) return null;
  return <section aria-label="0G request receipts" style={{ marginTop: 12, padding: "12px 0", borderTop: "1px solid #D9C8BE", fontSize: 11, lineHeight: 1.5, color: "#766B65", width: "100%", boxSizing: "border-box", maxHeight: 140, overflowY: "auto", flexShrink: 0 }}>
    <p style={{ margin: "0 0 6px", fontSize: 11 }}>Recent 0G requests</p>
    {unique.map((request) => <p key={request.requestId} style={{ margin: "4px 0", fontSize: 11 }}>
      {labels[request.task] ?? request.task}{request.outcome && request.outcome !== "ok" ? ` · ${request.outcome}` : ""}<br />
      <span style={{ fontFamily: "ui-monospace, monospace", overflowWrap: "anywhere", userSelect: "text" }}>{request.requestId}</span>
    </p>)}
  </section>;
}

export function RallyAiRequests({ rallyId }: { rallyId: string | null | undefined }) {
  const { api } = useSession();
  const load = useCallback(() => api.getAiReceipts(rallyId!), [api, rallyId]);
  const { data, error } = usePolled(rallyId ? load : null, 15_000);
  if (!rallyId) return null;
  if (error) return <p style={{ fontSize: 11, color: "#766B65" }}>0G request receipts are temporarily unavailable.</p>;
  return <AiRequests requests={data?.receipts ?? []} />;
}
