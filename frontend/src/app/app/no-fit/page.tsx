"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import RallyOrb from "@/components/RallyOrb";
import { errorMessage } from "@/lib/api";
import { displayTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

type Waiting = { goal: string | null; until: string | null; movedOn: boolean; hasMatch: boolean };

export default function NoFitScreen() {
  // "No match" is never a dead end. Two things can be waiting: a published rally the
  // scheduler found no fit for (?rally=), or an interest kept active (?intent=).
  const { api } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const rallyId = params.get("rally");
  const intentId = params.get("intent");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Waiting> => {
    if (rallyId) {
      const rally = await api.getRally(rallyId);
      return { goal: rally.goal, until: rally.expiresAt, movedOn: rally.status !== "waiting", hasMatch: false };
    }
    const { matches, waiting } = await api.listMatches();
    const intent = waiting.find((w) => w.id === intentId) ?? (intentId ? undefined : waiting[0]);
    const hasMatch = matches.some((m) => m.status === "pending" && new Date(m.holdUntil).getTime() > Date.now());
    return { goal: intent?.goal ?? null, until: intent?.expiresAt ?? null, movedOn: !intent, hasMatch };
  }, [api, rallyId, intentId]);
  const { data, error, loaded } = usePolled(load, 15_000);

  useEffect(() => {
    if (!data?.movedOn) return;
    // Things changed since this screen opened, so it no longer applies.
    router.replace(rallyId ? `/app/finding-people?rally=${rallyId}` : "/app/home");
  }, [data, rallyId, router]);

  const stopLooking = async () => {
    setBusy(true);
    setActionError(null);
    try {
      if (rallyId) await api.cancelRally(rallyId);
      else if (intentId) await api.cancelIntent(intentId);
      router.replace("/app/home");
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  };

  const invite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
    } catch {
      setActionError("Couldn't copy the link on this device.");
    }
  };

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", height: "100dvh", display: "flex", justifyContent: "center", padding: "0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .ib { width: 44px; height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 1px solid #D9C8BE; border-radius: 50%; background: #FFFAF7; color: #1C1917; position: relative; flex-shrink: 0; }
        .ib:hover { border-color: #1C1917; color: #1C1917; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .h1 { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 30px; line-height: 1.08; letter-spacing: -.01em; }
        .em { font-style: italic; color: #315FE8; }
        .card { background: #FFFAF7; border: 1px solid #D9C8BE; border-radius: 16px; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; height: 56px; border-radius: 999px; font-size: 16px; font-weight: 600; text-decoration: none; box-sizing: border-box; transition: transform .12s ease-out, background .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .foot { padding: 16px 24px 32px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
        .alt { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 56px; padding: 0; border: 0; border-top: 1px solid #D9C8BE; background: transparent; font-family: inherit; text-align: left; color: #1C1917; cursor: pointer; }
        .breathe { animation: breathe 4s ease-in-out infinite; }
        @keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
        @media (prefers-reduced-motion: reduce) { .breathe { animation: none; } }
      `}</style>

      <div
        style={{
          width: "100%", maxWidth: "430px",
          height: "100%",
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
            Waiting
          </span>
          <span style={{ width: "44px" }} />
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div className="breathe">
              <RallyOrb variant="searching" size={88} />
            </div>
            <div>
              <h1 className="h1">
                No close fit <span className="em">yet</span>
              </h1>
            </div>
          </div>
          <p role={error ? "alert" : undefined} style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "#766B65" }}>
            {error && !data
              ? errorMessage(error)
              : "Nobody fits this plan right now. We check again every two minutes and when plans change."}
          </p>

          {loaded && data && (
            <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
                <span style={{ fontFamily: SERIF, fontSize: "20px" }}>{data.goal ?? "Your plan"}</span>
                {data.until && <span style={{ fontFamily: MONO, fontSize: "13px", flexShrink: 0 }}>until {displayTime(data.until)}</span>}
              </div>
              <span style={{ fontSize: "13px", lineHeight: 1.4, color: "#766B65" }}>
                Still active. When someone fits, it lands in your Rally inbox, and you still choose.
              </span>
              {data.hasMatch && (
                <a href="/app/match-found" style={{ fontSize: "15px", fontWeight: 600, color: "#315FE8" }}>
                  You have a match waiting
                </a>
              )}
            </div>
          )}

          {actionError && (
            <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#EC562E" }}>
              {actionError}
            </p>
          )}
        </div>

        <div className="foot">
          <a className="btn btn-p" href="/app/discover">
            Browse live rallies
          </a>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <button
              type="button"
              onClick={() => void invite()}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "44px", padding: 0, border: 0, background: "transparent", fontFamily: "inherit", fontSize: "15px", fontWeight: 500, color: "#1C1917", cursor: "pointer" }}
            >
              {copied ? "Invite link copied" : "Invite a friend"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void stopLooking()}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "44px", padding: 0, border: 0, background: "transparent", fontFamily: "inherit", fontSize: "15px", fontWeight: 500, color: "#766B65", cursor: "pointer" }}
            >
              {busy ? "Stopping…" : "Stop looking"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
