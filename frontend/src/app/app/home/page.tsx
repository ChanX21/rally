"use client";

import { useCallback } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import RallyOrb from "@/components/RallyOrb";
import { ACTIVE_RALLY_STATUSES, rallyPath } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

export default function HomeScreen() {
  const { status, me, api } = useSession();
  const signedIn = status === "ready" && me?.user.onboarded === true;

  // Unread count, plus the one thing most worth coming back to: a match waiting
  // for an answer, otherwise a rally still in progress.
  const load = useCallback(async () => {
    const [notes, matches, rallies] = await Promise.all([
      api.listNotifications({ limit: 1, unreadOnly: true }),
      api.listMatches(),
      api.listRallies({ limit: 20 }),
    ]);
    const now = Date.now();
    const match = matches.matches.find((m) => m.status === "pending" && new Date(m.holdUntil).getTime() > now);
    const rally = rallies.items.find((r) => ACTIVE_RALLY_STATUSES.includes(r.status))
      ?? rallies.items.find((r) => r.proofFlow && r.status === "completed" && r.completedAt && now - new Date(r.completedAt).getTime() < 48 * 3600000);
    const waiting = matches.waiting[0];
    const banner = match
      ? { kicker: "Needs your answer", title: `You have been matched: ${match.rally.goal}`, href: `/app/match-found?id=${match.id}` }
      : rally
      ? { kicker: "Your Rally", title: rally.goal, href: rallyPath(rally.status, rally.id) }
      : waiting
      ? { kicker: "Interest active", title: waiting.goal ?? "Still looking for you", href: `/app/no-fit?intent=${waiting.id}` }
      : null;
    return { unread: notes.unreadCount, banner };
  }, [api]);
  const { data } = usePolled(signedIn ? load : null, 15_000);
  const unread = data?.unread ?? 0;

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", height: "100dvh", display: "flex", justifyContent: "center", padding: "24px 0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .bar { display: flex; align-items: center; justify-content: space-between; height: 64px; padding: 12px 24px 0; box-sizing: border-box; flex-shrink: 0; }
        .ib { width: 44px; height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 1px solid #D9C8BE; border-radius: 50%; background: #FFFAF7; color: #1C1917; position: relative; flex-shrink: 0; }
        .ib:hover { border-color: #1C1917; color: #1C1917; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .hero { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 36px; line-height: 1.05; letter-spacing: -.015em; }
        .em { font-style: italic; color: #315FE8; }
        .btn-browse { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 56px; border-radius: 999px; border: 1px solid #1C1917; background: #FFFAF7; font-family: inherit; font-size: 16px; font-weight: 600; text-decoration: none; color: #1C1917; box-sizing: border-box; transition: background .12s ease-out, color .12s ease-out; }
        .btn-browse:hover { background: #1C1917; color: #FFF5EF; }
        .breathe { animation: breathe 3.2s ease-in-out infinite; }
        @keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.035); } }
        @media (prefers-reduced-motion: reduce) { .breathe { animation: none; } }
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
        <div className="bar">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <svg width="24" height="24" viewBox="0 0 26 26" aria-hidden="true">
              <circle cx="13" cy="13" r="11.5" fill="none" stroke="#1C1917" strokeWidth="1.5" />
              <circle cx="13" cy="8.6" r="2.3" fill="#1C1917" />
              <circle cx="8.8" cy="15.8" r="2.3" fill="#315FE8" />
              <circle cx="17.2" cy="15.8" r="2.3" fill="#F06445" />
            </svg>
            <span style={{ fontWeight: 600, fontSize: "17px", letterSpacing: "-0.01em" }}>Rally</span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <a className="ib" href="/app/profile" aria-label="Your profile">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8.5" r="3.5" />
                <path d="M5 20a7 7 0 0 1 14 0" />
              </svg>
            </a>
            <a className="ib" href="/app/inbox" aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
                <path d="M10 20.5a2 2 0 0 0 4 0" />
              </svg>
              {unread > 0 && <span style={{ position: "absolute", top: "8px", right: "9px", width: "9px", height: "9px", borderRadius: "50%", background: "#F06445", border: "2px solid #FFFAF7" }} />}
            </a>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px", textAlign: "center" }}>
          <div className="breathe">
            <RallyOrb variant="active" size={184} />
          </div>
          <h1 className="hero" style={{ marginTop: "32px" }}>
            Rally is <span className="em">looking</span>
          </h1>
          <p style={{ margin: "12px 0 0", maxWidth: "300px", fontSize: "15px", lineHeight: 1.5, color: "#766B65" }}>
            We match you into plans nearby that fit. When one does, it lands in your inbox — you always choose.
          </p>
        </div>

        <div style={{ padding: "0 24px 32px", display: "flex", flexDirection: "column", gap: "16px", flexShrink: 0 }}>
          {data?.banner && (
            <a
              href={data.banner.href}
              style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderRadius: "16px", background: "#F8DDD3", textDecoration: "none", color: "#1C1917" }}
            >
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", textAlign: "left" }}>
                <span className="mono" style={{ color: "#1C1917" }}>
                  {data.banner.kicker}
                </span>
                <span style={{ fontSize: "14px", lineHeight: 1.35 }}>{data.banner.title}</span>
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M9 6l6 6-6 6" />
              </svg>
            </a>
          )}
          {!data?.banner && (
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "#766B65", textAlign: "center" }}>
              No match yet. We only look again when someone new joins or plans change — we&apos;ll notify you.
            </p>
          )}
          <a className="btn-browse" href="/app/discover">
            Browse live plans
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
