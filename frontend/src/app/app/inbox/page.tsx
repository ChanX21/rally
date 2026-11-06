"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { errorMessage, type Notification } from "@/lib/api";
import { notificationPath, timeAgo } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

export default function InboxScreen() {
  const { api } = useSession();
  const router = useRouter();
  const [older, setOlder] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [readIds, setReadIds] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Polled at the handoff's rate: there is no push or SSE yet.
  const load = useCallback(() => api.listNotifications({ limit: 20 }), [api]);
  const { data, error, loaded, refresh } = usePolled(load, 15_000);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const nextCursor = cursor === undefined ? data?.nextCursor ?? null : cursor;
  const firstIds = new Set(data?.items.map((n) => n.id));
  const items = [...(data?.items ?? []), ...older.filter((n) => !firstIds.has(n.id))];
  const isUnread = (n: Notification) => !n.readAt && !readIds[n.id];

  const open = (n: Notification) => {
    if (isUnread(n)) {
      setReadIds((prev) => ({ ...prev, [n.id]: true }));
      // Reading is best effort: a failure must not stop them reaching the screen.
      void api.markNotificationRead(n.id).catch(() => {});
    }
    router.push(notificationPath(n.type, n.data));
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    try {
      const page = await api.listNotifications({ limit: 20, cursor: nextCursor });
      setOlder((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const markAll = async () => {
    try {
      await api.markAllNotificationsRead();
      setReadIds((prev) => ({ ...prev, ...Object.fromEntries(items.map((n) => [n.id, true])) }));
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const unread = data ? Math.max(0, data.unreadCount - Object.keys(readIds).filter((id) => data.items.some((n) => n.id === id && !n.readAt)).length) : 0;

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", height: "100dvh", display: "flex", justifyContent: "center", padding: "24px 0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .ib { width: 44px; height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 1px solid #D9C8BE; border-radius: 50%; background: #FFFAF7; color: #1C1917; position: relative; flex-shrink: 0; }
        .ib:hover { border-color: #1C1917; color: #1C1917; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .hero { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 36px; line-height: 1.05; letter-spacing: -.015em; }
        .em { font-style: italic; color: #315FE8; }
        .card { background: #FFFAF7; border: 1px solid #D9C8BE; border-radius: 16px; }
        .note { display: flex; gap: 12px; width: 100%; padding: 16px; border: 0; border-top: 1px solid #D9C8BE; background: transparent; font-family: inherit; text-align: left; color: #1C1917; cursor: pointer; transition: background .12s ease-out; }
        .note:first-child { border-top: 0; }
        .note:hover { background: #E5ECFF; color: #1C1917; }
      `}</style>

      <div
        style={{
          width: "390px",
          height: "844px",
          boxSizing: "border-box",
          background: "#FFF5EF",
          color: "#1C1917",
          fontFamily: SANS,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
          borderRadius: "36px",
          boxShadow: "0 1px 3px rgba(0,0,0,.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "64px", padding: "12px 24px 0", boxSizing: "border-box", flexShrink: 0 }}>
          <a className="ib" href="/app/home" aria-label="Back to home">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </a>
          <span className="mono" style={{ color: "#1C1917" }}>
            {unread > 0 ? `${unread} new` : "All read"}
          </span>
          {unread > 0 ? (
            <button type="button" onClick={() => void markAll()} className="mono" style={{ width: "44px", padding: 0, border: 0, background: "transparent", color: "#315FE8", cursor: "pointer" }}>
              Read all
            </button>
          ) : (
            <span style={{ width: "44px" }} />
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto" }}>
          <div>
            <h1 className="hero">
              Your <span className="em">inbox</span>
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: "15px", lineHeight: 1.5, color: "#766B65" }}>
              Everything Rally needs you to see lands here, even if alerts are off.
            </p>
          </div>

          {!loaded && <p role="status" className="mono">Loading…</p>}
          {(actionError !== null || (error !== null && !data)) && (
            <p role="alert" style={{ margin: 0, fontSize: "14px", lineHeight: 1.45, color: "#EC562E" }}>
              {actionError ?? errorMessage(error)}
            </p>
          )}
          {data && items.length === 0 && (
            <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.45, color: "#766B65" }}>Nothing yet. Matches and updates will land here.</p>
          )}

          {items.length > 0 && (
            <div className="card" style={{ overflow: "hidden", flexShrink: 0 }}>
              {items.map((n) => {
                const isNew = isUnread(n);
                return (
                  <button key={n.id} type="button" className="note" onClick={() => open(n)}>
                    <span
                      style={
                        isNew
                          ? { width: "8px", height: "8px", marginTop: "7px", borderRadius: "50%", background: "#F06445", flexShrink: 0 }
                          : { width: "8px", height: "8px", marginTop: "7px", flexShrink: 0 }
                      }
                    />
                    <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "15px", fontWeight: isNew ? 600 : 400, lineHeight: 1.35 }}>{n.title}</span>
                      <span style={{ fontSize: "13px", color: "#766B65" }}>{n.body}</span>
                    </span>
                    <span className="mono" style={{ flexShrink: 0 }}>
                      {now === null ? "" : timeAgo(n.createdAt, now)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {nextCursor && (
            <button type="button" onClick={() => void loadMore()} style={{ flexShrink: 0, minHeight: "44px", border: 0, background: "transparent", fontFamily: "inherit", fontSize: "15px", fontWeight: 500, color: "#1C1917", cursor: "pointer" }}>
              Show older
            </button>
          )}
        </div>
        <div style={{ height: "32px", flexShrink: 0 }} />
      </div>
    </div>
  );
}
