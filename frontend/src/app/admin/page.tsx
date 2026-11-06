"use client";

import { useCallback, useState } from "react";
import { type AdminDispute, API_BASE, type RewardPolicy } from "@/lib/api";

const ACTIONS = ["OnTime", "HostCompleted", "Vouched", "Late", "LateCancel", "NoShow", "ComplaintUpheld", "FalseComplaint"];
const OUTCOMES = ["upheld", "dismissed", "false"] as const;

const cell = { padding: "8px", border: "1px solid #D9C8BE", borderRadius: "8px", fontFamily: "inherit", fontSize: "14px", background: "#FFFAF7", color: "#1C1917" } as const;
const button = { ...cell, minHeight: "36px", cursor: "pointer", fontWeight: 600 } as const;

export default function AdminScreen() {
  // Kept in memory only, so the token is gone as soon as this tab closes.
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [policy, setPolicy] = useState<RewardPolicy | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [userFilter, setUserFilter] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      });
      const body = (await response.json()) as { success: boolean; data: T; error?: { message: string } };
      if (!body.success) throw new Error(body.error?.message ?? `Request failed (${response.status})`);
      return body.data;
    },
    [token]
  );

  const load = useCallback(
    async (user: string, onlyOpen: boolean) => {
      const params = new URLSearchParams();
      if (user) params.set("userId", user);
      if (onlyOpen && !user) params.set("status", "open");
      try {
        setDisputes(await call<AdminDispute[]>(`/internal/disputes?${params.toString()}`));
        const current = await call<RewardPolicy>("/internal/reward-policy");
        setPolicy(current);
        setDraft(Object.fromEntries(ACTIONS.map((a) => [a, String(current.amounts[a])])));
        setConnected(true);
        setNote(null);
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Could not load that.");
      }
    },
    [call]
  );

  const showHistory = (userId: string) => {
    setUserFilter(userId);
    void load(userId, openOnly);
  };

  const rule = async (id: string, outcome: (typeof OUTCOMES)[number]) => {
    try {
      await call(`/internal/disputes/${id}/resolve`, { method: "POST", body: JSON.stringify({ outcome }) });
      await load(userFilter, openOnly);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save that ruling.");
    }
  };

  const publish = async () => {
    try {
      const amounts = Object.fromEntries(ACTIONS.map((a) => [a, Number(draft[a])]));
      const next = await call<RewardPolicy>("/internal/reward-policy", {
        method: "PUT",
        body: JSON.stringify({ amounts }),
      });
      setPolicy(next);
      setNote(`Published policy version ${next.version}. It applies to new points only.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not publish that policy.");
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#FFF5EF", color: "#1C1917", fontFamily: "system-ui, sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
        <h1 style={{ margin: 0, fontSize: "24px" }}>Rally admin</h1>

        {!connected && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load("", true);
            }}
            style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
          >
            <input
              type="password"
              aria-label="Admin token"
              placeholder="Admin token"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{ ...cell, flex: 1, minWidth: "220px" }}
            />
            <button type="submit" disabled={!token} style={button}>
              Connect
            </button>
          </form>
        )}

        {note && (
          <p role="status" style={{ margin: 0, fontSize: "14px" }}>
            {note}
          </p>
        )}

        {connected && (
          <>
            <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
                <h2 style={{ margin: 0, fontSize: "18px", flex: 1 }}>{userFilter ? "Full history for one person" : "Disputes"}</h2>
                {userFilter ? (
                  <button type="button" style={button} onClick={() => showHistory("")}>
                    Back to all
                  </button>
                ) : (
                  <label style={{ fontSize: "14px" }}>
                    <input
                      type="checkbox"
                      checked={openOnly}
                      onChange={(e) => {
                        setOpenOnly(e.target.checked);
                        void load("", e.target.checked);
                      }}
                    />{" "}
                    Open only
                  </label>
                )}
              </div>
              {disputes.length === 0 && <p style={{ margin: 0, fontSize: "14px", color: "#766B65" }}>Nothing here.</p>}
              {disputes.map((d) => (
                <article key={d.id} style={{ ...cell, padding: "12px", display: "flex", flexDirection: "column", gap: "8px", overflowWrap: "anywhere" }}>
                  <strong>
                    {d.category.replaceAll("_", " ")} · {d.status}
                  </strong>
                  <span style={{ fontSize: "13px", color: "#766B65" }}>
                    {d.rallyGoal} · {new Date(d.createdAt).toLocaleString()}
                  </span>
                  <p style={{ margin: 0 }}>{d.description}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "13px" }}>
                    <button type="button" style={button} onClick={() => showHistory(d.raiser.id)}>
                      From: {d.raiser.displayName ?? d.raiser.id.slice(0, 8)}
                    </button>
                    <button type="button" style={button} onClick={() => showHistory(d.subject.id)}>
                      About: {d.subject.displayName ?? d.subject.id.slice(0, 8)}
                    </button>
                  </div>
                  {d.status === "open" ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {OUTCOMES.map((outcome) => (
                        <button key={outcome} type="button" style={button} onClick={() => void rule(d.id, outcome)}>
                          {outcome === "false" ? "False report" : outcome === "upheld" ? "Uphold" : "Dismiss"}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: "13px", color: "#766B65" }}>
                      Ruled by {d.resolvedBy} · on-chain: {d.chainStatus}
                    </span>
                  )}
                </article>
              ))}
            </section>

            <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <h2 style={{ margin: 0, fontSize: "18px" }}>Points policy {policy ? `· version ${policy.version}` : ""}</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
                {ACTIONS.map((action) => (
                  <label key={action} style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                    {action}
                    <input
                      type="number"
                      min={-100}
                      max={100}
                      value={draft[action] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [action]: e.target.value })}
                      style={cell}
                    />
                  </label>
                ))}
              </div>
              <div>
                <button type="button" style={button} onClick={() => void publish()}>
                  Publish new version
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
