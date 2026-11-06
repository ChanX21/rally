"use client";

import { useCallback } from "react";
import type { AiRequest } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

export function AiRequests({ requests }: { requests: readonly AiRequest[] }) {
  const request = requests.find((entry) => entry.requestId);
  if (!request) return null;
  return <p aria-label="0G request" title={request.requestId} style={{ margin: "4px 0 0", fontSize: 10, lineHeight: 1.3, color: "#766B65", textAlign: "center", overflowWrap: "anywhere", userSelect: "text", gridColumn: "1 / -1" }}>
    0G request: <span style={{ fontFamily: "ui-monospace, monospace" }}>{request.requestId}</span>
    {request.outcome && request.outcome !== "ok" ? ` · ${request.outcome}` : ""}
  </p>;
}

export function RallyAiRequests({ rallyId, task = "composition" }: { rallyId: string | null | undefined; task?: string }) {
  const { api } = useSession();
  const load = useCallback(() => api.getAiReceipts(rallyId!), [api, rallyId]);
  const { data } = usePolled(rallyId ? load : null, 15_000);
  if (!rallyId) return null;
  return <AiRequests requests={data?.receipts.filter((request) => request.task === task) ?? []} />;
}
