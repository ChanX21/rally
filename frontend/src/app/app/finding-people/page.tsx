"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import RallyOrb from "@/components/RallyOrb";
import { errorCode, errorMessage, type Rally } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

const STEPS = ["Plan published", "Looking for people", "People are deciding", "Meeting point set"];

// How far along the steps each state is. A rally can move backward: a withdrawal
// can return it to open or proposed, so this always follows the server.
const STEP_FOR_STATUS: Partial<Record<Rally["status"], number>> = {
  draft: 0,
  open: 1,
  waiting: 1,
  proposed: 2,
  ready: 3,
  formed: 4,
  met: 4,
  completed: 4,
};

// Copy per state. "proposed" is never "joined", and nothing says "meeting
// confirmed" before "formed".
function describe(rally: Rally, isCreator: boolean): { title1: string; title2: string; sub: string } {
  switch (rally.status) {
    case "draft":
      return { title1: "Not published", title2: "yet", sub: "Nobody can see this plan until you publish it." };
    case "open":
    case "waiting":
      return { title1: "Finding", title2: "your people", sub: "You can leave this screen. We'll put the result in your inbox." };
    case "proposed":
      return isCreator
        ? { title1: "People are", title2: "deciding", sub: "Nobody is added without saying yes. We'll tell you when enough have." }
        : { title1: "Waiting for", title2: "the others", sub: "You said yes. The group forms when enough people have." };
    case "ready":
      return isCreator
        ? { title1: "Enough people.", title2: "Where to meet?", sub: "Only the group ever sees this. The room opens once you set it." }
        : { title1: "Almost", title2: "there", sub: "Enough people said yes. Waiting for the host to set a meeting point." };
    case "formed":
      return { title1: "Your Rally", title2: "is on", sub: "The group has formed. The meeting point is in your room." };
    case "met":
      return { title1: "You", title2: "met", sub: "Tell us how it went." };
    case "completed":
      return { title1: "All", title2: "done", sub: "This Rally is finished. Thanks for coming." };
    case "cancelled":
      return { title1: "This Rally", title2: "was cancelled", sub: "No harm done. Start another whenever you like." };
    case "expired":
      return { title1: "This Rally", title2: "has ended", sub: "Its time ran out. Start another whenever you like." };
  }
}

// A plan is for one day, so a clock time is read on the day its window starts.
function meetTimeOn(windowStart: string, clock: string): string {
  const [hours, minutes] = clock.split(":").map(Number);
  const date = new Date(windowStart);
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return date.toISOString();
}

export default function FindingPeopleScreen() {
  // The live status of one rally, polled from the server. Every state in the handoff's table lands here.
  const { api, me } = useSession();
  const router = useRouter();
  const rallyId = useSearchParams().get("rally");
  const [meetingPoint, setMeetingPoint] = useState("");
  const [meetClock, setMeetClock] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => api.getRally(rallyId ?? ""), [api, rallyId]);
  const { data: rally, error, loaded, refresh, setData } = usePolled(rallyId ? load : null, 10_000);

  useEffect(() => {
    if (!rallyId) router.replace("/app/home");
    else if (rally?.status === "waiting" && rally.creatorId === me?.user.id) router.replace(`/app/no-fit?rally=${rallyId}`);
  }, [rallyId, rally, me, router]);

  const isCreator = rally?.creatorId === me?.user.id;

  const act = async (run: () => Promise<Rally>) => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await run());
    } catch (err) {
      setActionError(errorMessage(err));
      // Someone else changed it first: reload, so the next try has the right version.
      if (errorCode(err) === "VERSION_CONFLICT" || errorCode(err) === "INVALID_STATE") refresh();
    } finally {
      setBusy(false);
    }
  };

  const copy = rally ? describe(rally, isCreator) : null;
  const missing = !rally && loaded && error;
  const active = rally ? (STEP_FOR_STATUS[rally.status] ?? -1) : -1;
  const over = rally?.status === "cancelled" || rally?.status === "expired";
  const needsMeetingPoint = rally?.status === "ready" && isCreator && !rally.hasMeetingPoint;
  const canLeave = rally && ["draft", "open", "waiting", "proposed", "ready"].includes(rally.status);

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .h1 { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 30px; line-height: 1.08; letter-spacing: -.01em; }
        .em { font-style: italic; color: #315FE8; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 56px; border: 0; border-radius: 999px; font-family: inherit; font-size: 16px; font-weight: 600; text-decoration: none; box-sizing: border-box; cursor: pointer; transition: transform .12s ease-out, background .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .btn:disabled { background: #E8DFDA; color: #766B65; cursor: not-allowed; }
        .btn:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .lnk { display: flex; align-items: center; justify-content: center; width: 100%; height: 44px; padding: 0; border: 0; background: transparent; font-family: inherit; font-size: 15px; font-weight: 500; color: #1C1917; cursor: pointer; }
        .foot { padding: 12px 24px 32px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; min-height: 152px; box-sizing: border-box; justify-content: flex-end; }
        .step { display: flex; align-items: center; gap: 16px; min-height: 48px; font-size: 15px; }
        .mark { width: 24px; height: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: #FFF5EF; }
        .field { width: 100%; height: 52px; padding: 0 16px; border-radius: 16px; border: 1px solid #1C1917; background: #FFFAF7; font-family: inherit; font-size: 16px; color: #1C1917; box-sizing: border-box; outline: none; }
        .field:focus { border: 1.5px solid #315FE8; }
        .breathe { animation: breathe 2.6s ease-in-out infinite; }
        @keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .orbit { animation: orbit 6s linear infinite; transform-origin: 50% 50%; }
        @keyframes orbit { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .breathe, .spin, .orbit { animation: none; } }
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "64px", padding: "12px 24px 0", boxSizing: "border-box", flexShrink: 0 }}>
          <span className="mono" style={{ color: "#1C1917", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {rally?.goal ?? "Your Rally"}
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 24px 0", overflowY: "auto" }}>
          <div style={{ position: "relative", width: "200px", height: "200px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg className="orbit" width="200" height="200" viewBox="0 0 240 240" aria-hidden="true" style={{ position: "absolute", left: 0, top: 0 }}>
              <circle cx="120" cy="120" r="114" fill="none" stroke="#766B65" strokeWidth="0.75" strokeDasharray="0.75 6" strokeLinecap="round" />
            </svg>
            <div className="breathe">
              <RallyOrb variant="active" size={156} />
            </div>
          </div>

          {missing ? (
            <p role="alert" style={{ margin: "24px 0 0", fontSize: "15px", lineHeight: 1.45, textAlign: "center" }}>
              {errorMessage(error)}
            </p>
          ) : copy ? (
            <>
              <h1 className="h1" style={{ marginTop: "16px", textAlign: "center" }}>
                {copy.title1} <span className="em">{copy.title2}</span>
              </h1>
              <p role="status" style={{ margin: "8px 0 0", maxWidth: "310px", fontSize: "14px", lineHeight: 1.45, color: "#766B65", textAlign: "center" }}>
                {copy.sub}
              </p>
            </>
          ) : (
            <p role="status" className="mono" style={{ marginTop: "24px" }}>Loading…</p>
          )}

          {rally && !over && (
            <ol
              style={{
                listStyle: "none",
                margin: "16px 0 0",
                padding: 0,
                width: "100%",
                backgroundImage: "linear-gradient(#D9C8BE, #D9C8BE)",
                backgroundSize: "1px calc(100% - 48px)",
                backgroundPosition: "11.5px 24px",
                backgroundRepeat: "no-repeat",
              }}
            >
              {STEPS.map((label, i) => {
                const done = i < active;
                const isActive = i === active;
                return (
                  <li key={label} className="step" style={isActive ? { fontWeight: 600 } : !done ? { color: "#766B65" } : undefined}>
                    <span className="mark">
                      {done && (
                        <span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#1C1917", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFF5EF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </span>
                      )}
                      {isActive && (
                        <svg className="spin" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="10" fill="#FFF5EF" stroke="#F8DDD3" strokeWidth="3" />
                          <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="#F06445" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      )}
                      {!done && !isActive && <span style={{ width: "24px", height: "24px", borderRadius: "50%", border: "1.5px dashed #766B65", boxSizing: "border-box", background: "#FFF5EF" }} />}
                    </span>
                    <span style={{ flex: 1 }}>{label}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="foot">
          {actionError && (
            <div role="alert" className="mono" style={{ textAlign: "center", color: "#EC562E" }}>
              {actionError}
            </div>
          )}
          {needsMeetingPoint && rally && (
            <>
              <input
                className="field"
                type="text"
                maxLength={300}
                aria-label="Meeting point"
                placeholder="Food court, north entrance"
                value={meetingPoint}
                onChange={(e) => setMeetingPoint(e.target.value)}
              />
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", fontSize: "14px", color: "#766B65" }}>
                Meeting time (optional)
                <input
                  type="time"
                  value={meetClock}
                  onChange={(e) => setMeetClock(e.target.value)}
                  style={{ height: "44px", padding: "0 12px", borderRadius: "12px", border: "1px solid #D9C8BE", background: "#FFFAF7", fontFamily: "inherit", fontSize: "15px", color: "#1C1917" }}
                />
              </label>
              <button
                className="btn btn-p"
                type="button"
                disabled={busy || !meetingPoint.trim()}
                onClick={() =>
                  void act(() =>
                    api.updateRally(rally.id, {
                      expectedVersion: rally.version,
                      meetingPoint: meetingPoint.trim(),
                      ...(meetClock ? { meetAt: meetTimeOn(rally.windowStart, meetClock) } : {}),
                    })
                  )
                }
              >
                {busy ? "Saving…" : "Open the room"}
              </button>
            </>
          )}
          {rally?.status === "draft" && isCreator && (
            <button className="btn btn-p" type="button" disabled={busy} onClick={() => void act(() => api.publishRally(rally.id))}>
              Publish this plan
            </button>
          )}
          {rally?.status === "formed" && (
            <a className="btn btn-p" href={`/app/room?id=${rally.id}`}>
              Go to your room
            </a>
          )}
          {(rally?.status === "met" || rally?.status === "completed") && (
            <a className="btn btn-p" href={`/app/feedback?id=${rally.id}`}>
              How did it go?
            </a>
          )}
          {canLeave && rally && (
            <button
              className="lnk"
              type="button"
              disabled={busy}
              onClick={() => void act(() => (isCreator ? api.cancelRally(rally.id) : api.withdrawFromRally(rally.id)))}
            >
              {isCreator ? "Cancel this Rally" : "Withdraw"}
            </button>
          )}
          <a className="lnk" href="/app/home" style={{ textDecoration: "underline" }}>
            Back to home
          </a>
        </div>
      </div>
    </div>
  );
}
