"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import RallyOrb from "@/components/RallyOrb";
import { errorCode, errorMessage, type Match } from "@/lib/api";
import { capitalize, countdown, displayTime, zoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

// The handoff's wording for each way an answer can fail.
function respondError(err: unknown): string {
  switch (errorCode(err)) {
    case "RALLY_FULL":
      return "Someone took the last seat.";
    case "OFFER_EXPIRED":
    case "OFFER_CLOSED":
    case "RALLY_CLOSED":
    case "ROLE_TAKEN":
    case "MEMBER_CONFLICT":
      return "This match is no longer available.";
    case "SCHEDULE_CONFLICT":
      return "You already have a rally at this time.";
    default:
      return errorMessage(err);
  }
}

export default function MatchFoundScreen() {
  // Nothing is ever accepted on the user's behalf. Accepting moves to the rally's
  // status screen: a yes is not yet a room.
  const { api } = useSession();
  const router = useRouter();
  const matchId = useSearchParams().get("id");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [alreadyAccepted, setAlreadyAccepted] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  // Opened from a notification: that match. Opened bare: the newest one waiting for an answer.
  const load = useCallback(async (): Promise<Match | null> => {
    if (matchId) return api.getMatch(matchId);
    const { matches } = await api.listMatches();
    return matches.find((m) => m.status === "pending" && new Date(m.holdUntil).getTime() > Date.now()) ?? null;
  }, [api, matchId]);
  const { data: match, error, loaded, setData } = usePolled(load, 10_000);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, []);

  const msLeft = match && now !== null ? new Date(match.holdUntil).getTime() - now : null;
  const pending = match?.status === "pending" && (msLeft === null || msLeft > 0);

  const respond = async (response: "accept" | "decline") => {
    if (!match) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await api.respondToMatch(match.id, response);
      setData(updated);
      router.replace(response === "accept" ? `/app/finding-people?rally=${updated.rally.id}` : "/app/home");
    } catch (err) {
      setAlreadyAccepted(errorCode(err) === "ALREADY_ACCEPTED");
      setActionError(respondError(err));
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!match) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.withdrawFromRally(match.rally.id);
      router.replace("/app/home");
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  };

  const rally = match?.rally;

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
        .hero { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 36px; line-height: 1.05; letter-spacing: -.015em; }
        .em { font-style: italic; color: #315FE8; }
        .card { background: #FFFAF7; border: 1px solid #D9C8BE; border-radius: 16px; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; height: 56px; border: 0; border-radius: 999px; font-family: inherit; font-size: 16px; font-weight: 600; text-decoration: none; box-sizing: border-box; cursor: pointer; transition: transform .12s ease-out, background .12s ease-out, border-color .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn:disabled { opacity: .55; cursor: not-allowed; }
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .btn-s { background: transparent; border: 1px solid #D9C8BE; color: #1C1917; }
        .btn-s:hover { border-color: #1C1917; color: #1C1917; }
        .foot { padding: 16px 24px 32px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; flex-shrink: 0; }
        .meta { display: flex; align-items: center; gap: 6px; font-size: 14px; }
        .pulse { animation: pulse 1.8s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: .35; } }
        @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
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
        <div aria-hidden="true" style={{ position: "absolute", right: "-56px", top: "52px" }}>
          <RallyOrb variant="celebration" size={196} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "64px", padding: "12px 24px 0", boxSizing: "border-box", flexShrink: 0, position: "relative", zIndex: 1 }}>
          <a className="ib" href="/app/inbox" aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </a>
          {pending && msLeft !== null && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                height: "32px",
                padding: "0 12px",
                borderRadius: "999px",
                background: "#1C1917",
                color: "#FFF5EF",
                fontFamily: MONO,
                fontSize: "12px",
                fontWeight: 500,
                letterSpacing: "0.04em",
              }}
            >
              <span className="pulse" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#F06445" }} />
              {countdown(msLeft)} TO REPLY
            </span>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "32px 24px 0", display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto", position: "relative" }}>
          {!loaded && <p role="status" className="mono">Loading…</p>}

          {loaded && !match && (
            <div>
              <h1 className="hero" style={{ maxWidth: "220px" }}>
                No match <span className="em">right now</span>
              </h1>
              <p role={error ? "alert" : undefined} style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: 1.45, color: "#766B65" }}>
                {error ? errorMessage(error) : "Nothing is waiting for your answer. We'll tell you in your inbox when something fits."}
              </p>
            </div>
          )}

          {match && rally && (
            <>
              <div>
                <div className="mono" style={{ color: "#1C1917" }}>
                  {pending ? "Proposal · needs your answer" : `Proposal · ${match.status}`}
                </div>
                <h1 className="hero" style={{ marginTop: "12px", maxWidth: "220px" }}>
                  {pending ? "You have been" : "This match is"} <span className="em">{pending ? "matched" : "closed"}</span>
                </h1>
              </div>

              <div className="card" style={{ overflow: "hidden" }}>
                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ fontFamily: SERIF, fontSize: "24px", lineHeight: 1.1 }}>{rally.goal}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                    <span className="meta">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#766B65" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                      </svg>
                      <span style={{ fontFamily: MONO }}>{displayTime(rally.windowStart)} · {rally.durationMin} min</span>
                    </span>
                    <span className="meta">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#766B65" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" />
                        <circle cx="12" cy="9" r="2.5" />
                      </svg>
                      {zoneLabel(rally.zone)}
                    </span>
                  </div>
                </div>
                <div style={{ padding: "16px", borderTop: "1px solid #D9C8BE", fontSize: "13px", lineHeight: 1.4 }}>
                  <strong style={{ fontWeight: 600 }}>
                    {rally.groupMin} to {rally.capacity} people · {rally.openSeats} {rally.openSeats === 1 ? "seat" : "seats"} open
                  </strong>
                  <br />
                  <span style={{ color: "#766B65" }}>You&apos;d join as: {capitalize(match.role)}</span>
                </div>
              </div>

              <div>
                <div className="mono">Why you fit</div>
                <p style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: 1.4 }}>{match.reason}</p>
                <div className="mono" style={{ marginTop: "12px" }}>
                  {match.source === "ai" ? "Composed by Rally intelligence · checked by Rally" : "Matched by Rally's rules"}
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "#766B65" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                The exact spot is shared once the group forms.
              </div>
              <p style={{ margin: "-12px 0 0", fontSize: "13px", lineHeight: 1.45, color: "#766B65" }}>
                Places go to the first people who accept. This invitation doesn&apos;t reserve a seat and expires at the deadline.
              </p>
            </>
          )}

          {actionError && (
            <p role="alert" style={{ margin: 0, fontSize: "14px", lineHeight: 1.45, color: "#EC562E" }}>
              {actionError}
            </p>
          )}
        </div>

        <div className="foot">
          {pending && !alreadyAccepted ? (
            <>
              <button className="btn btn-s" type="button" disabled={busy} onClick={() => void respond("decline")}>
                Decline
              </button>
              <button className="btn btn-p" type="button" disabled={busy} onClick={() => void respond("accept")}>
                Accept
              </button>
            </>
          ) : alreadyAccepted ? (
            <>
              <a className="btn btn-s" href="/app/home">
                Keep my seat
              </a>
              <button className="btn btn-p" type="button" disabled={busy} onClick={() => void withdraw()}>
                Withdraw
              </button>
            </>
          ) : (
            <a className="btn btn-p" href={match?.status === "accepted" && rally ? `/app/finding-people?rally=${rally.id}` : "/app/home"} style={{ gridColumn: "1 / -1" }}>
              {match?.status === "accepted" ? "See your Rally" : "Back to home"}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
