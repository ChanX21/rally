"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { RallyProof } from "@/components/RallyProof";
import { RallyTimer } from "@/components/RallyTimer";
import { Dropdown } from "@/components/Dropdown";
import { type DisputeCategory, errorCode, errorMessage } from "@/lib/api";
import { capitalize, displayTime, initials, zoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";
import RallyLoader from "@/components/RallyLoader";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

const fieldStyle = {
  width: "100%",
  height: "44px",
  padding: "0 12px",
  boxSizing: "border-box",
  borderRadius: "12px",
  border: "1px solid #D9C8BE",
  background: "#FFFAF7",
  fontFamily: "inherit",
  fontSize: "15px",
  color: "#1C1917",
} as const;

export default function RoomScreen() {
  // Meeting card and member list; there is no chat. Check-in is attested by the
  // host, and anyone the host doesn't mark present loses access to the rally.
  const { api, me } = useSession();
  const router = useRouter();
  const rallyId = useSearchParams().get("id");
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportWho, setReportWho] = useState("");
  const [reportKind, setReportKind] = useState<DisputeCategory>("misconduct");
  const [reportText, setReportText] = useState("");
  const [reported, setReported] = useState(false);

  const load = useCallback(() => api.getRoom(rallyId ?? ""), [api, rallyId]);
  const { data: room, error, loaded, refresh } = usePolled(rallyId ? load : null, 10_000);

  const myId = me?.user.id;
  const isHost = room?.members.some((m) => m.userId === myId && m.role === "host") ?? false;
  const others = room?.members.filter((m) => m.userId !== myId) ?? [];
  const presentIds = others.filter((m) => present[m.userId]).map((m) => m.userId);
  const formed = room?.status === "formed";
  const met = room?.status === "met" || room?.status === "completed";
  const host = room?.members.find((m) => m.role === "host");
  const iArrived = room?.members.find((m) => m.userId === myId)?.arrived ?? false;

  const arrive = async () => {
    if (!rallyId) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.markArrived(rallyId);
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    const description = reportText.trim();
    if (!rallyId || !reportWho || !description) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.raiseDispute(rallyId, { category: reportKind, subjectId: reportWho, description });
      setReported(true);
      setReporting(false);
      setReportText("");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const checkIn = async () => {
    if (!rallyId) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.checkIn(rallyId, presentIds);
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
      if (errorCode(err) === "INVALID_STATE") refresh();
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!rallyId) return;
    if (!confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      // The creator can't withdraw (409 CREATOR_CANNOT_WITHDRAW), so the host cancels instead.
      await (isHost ? api.cancelRally(rallyId) : api.withdrawFromRally(rallyId));
      router.replace("/app/home");
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  };

  // Accepted but not formed yet, or not a member (which includes after withdrawing).
  const code = errorCode(error);
  const locked = !room && code === "ROOM_LOCKED";
  const notMember = !room && code === "NOT_FOUND";

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
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 56px; border: 0; border-radius: 999px; font-family: inherit; font-size: 16px; font-weight: 600; text-decoration: none; box-sizing: border-box; cursor: pointer; transition: transform .12s ease-out, background .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .btn:disabled { background: #E8DFDA; color: #766B65; cursor: not-allowed; }
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .foot { padding: 12px 24px 32px; display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
        .sub { display: flex; justify-content: center; gap: 24px; }
        .sub button { display: flex; align-items: center; min-height: 44px; padding: 0; border: 0; background: transparent; font-family: inherit; font-size: 15px; font-weight: 500; color: #1C1917; text-decoration: underline; cursor: pointer; }
        .mem { display: flex; align-items: center; gap: 12px; min-height: 52px; border-top: 1px solid #D9C8BE; padding: 0 16px; }
        .mem:first-child { border-top: 0; }
        .av { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: #FFF5EF; background: #1C1917; flex-shrink: 0; }
        .av.you { background: #315FE8; }
        .cb { width: 24px; height: 24px; margin: 0; flex-shrink: 0; accent-color: #315FE8; cursor: pointer; }
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
          <span className="mono" style={{ color: "#1C1917", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "240px" }}>
            {room ? `${room.goal} · ${displayTime(room.meetAt)}` : "Your room"}
          </span>
          <span style={{ width: "44px" }} />
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto" }}>
          {!rallyId && <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.45 }}>Open your room from your inbox or the home screen.</p>}
          {rallyId && !loaded && <RallyLoader context="room" />}

          {!room && loaded && (
            <div>
              <h1 className="hero">
                {locked ? "Not formed" : notMember ? "Not your" : "Can't open"} <span className="em">{locked ? "yet" : notMember ? "room" : "the room"}</span>
              </h1>
              <p role={locked ? "status" : "alert"} style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: 1.45, color: "#766B65" }}>
                {locked
                  ? "You said yes. The room opens once the group has formed, and we'll put it in your inbox."
                  : notMember
                  ? "You aren't in this Rally, or you've left it."
                  : errorMessage(error)}
              </p>
              {locked && (
                <a href={`/app/finding-people?rally=${rallyId}`} style={{ display: "inline-block", marginTop: "12px", fontSize: "15px", fontWeight: 600, color: "#315FE8" }}>
                  See where things stand
                </a>
              )}
            </div>
          )}

          {room && (
            <>
              <div>
                <div className="mono" style={{ color: "#1C1917" }}>
                  {room.proofFlow && met ? "Completed automatically" : met ? "Checked in" : formed ? "Room formed" : capitalize(room.status)}
                </div>
                <h1 className="hero" style={{ marginTop: "12px" }}>
                  Your Rally <span className="em">{room.proofFlow && met ? "has ended" : met ? "happened" : "is on"}</span>
                </h1>
              </div>

              <RallyTimer room={room} />

              <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                {host && <span style={{ fontSize: "13px", color: "#766B65" }}>Host: {host.userId === myId ? "You" : host.displayName ?? "Rally member"}</span>}
                <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#315FE8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }}>
                    <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  <div>
                    <div style={{ fontSize: "16px", fontWeight: 600 }}>{room.meetingPoint ?? zoneLabel(room.zone)}</div>
                    <div style={{ marginTop: "2px", fontSize: "13px", color: "#766B65" }}>Only this group can see this.</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="mono">{isHost && formed && !room.proofFlow ? "Your crew · tick who's here" : "Your crew"}</div>
                <div className="card" style={{ marginTop: "8px" }}>
                  {room.members.map((m) => {
                    const mine = m.userId === myId;
                    const tickable = isHost && formed && !room.proofFlow && !mine;
                    const row = (
                      <>
                        <span className={`av${mine ? " you" : ""}`}>{mine ? "You" : initials(m.displayName)}</span>
                        <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "15px", fontWeight: 600 }}>{mine ? "You" : m.displayName ?? "Rally member"}</span>
                          <span style={{ fontSize: "13px", color: "#766B65" }}>
                            {capitalize(m.role)}
                            {tickable && m.arrived ? " · says they're here" : ""}
                          </span>
                        </span>
                      </>
                    );
                    return tickable ? (
                      <label key={m.userId} className="mem" style={{ cursor: "pointer" }}>
                        {row}
                        <input
                          className="cb"
                          type="checkbox"
                          checked={present[m.userId] ?? false}
                          onChange={(e) => setPresent({ ...present, [m.userId]: e.target.checked })}
                        />
                      </label>
                    ) : (
                      <div key={m.userId} className="mem">
                        {row}
                        <span style={{ fontSize: "13px", fontWeight: m.checkedIn ? 600 : 400, color: m.checkedIn ? "#1C1917" : "#766B65" }}>
                          {m.checkedIn ? "Checked in" : m.arrived ? "Here" : "Confirmed"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {room.proofFlow && room.status === "completed" && <RallyProof key={room.rallyId} rallyId={room.rallyId} />}

              {room.meetingBrief && (
                <div style={{ padding: "16px", borderRadius: "16px", background: "#F8DDD3" }}>
                  <div className="mono" style={{ color: "#1C1917" }}>
                    Meeting brief
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: "15px", lineHeight: 1.45 }}>{room.meetingBrief}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="foot">
          {actionError && (
            <p role="alert" style={{ margin: "0 0 8px", fontSize: "13px", lineHeight: 1.4, color: "#EC562E", textAlign: "center" }}>
              {actionError}
            </p>
          )}
          {room && formed && !room.proofFlow && !iArrived && (
            <button className="btn btn-p" type="button" disabled={busy} onClick={() => void arrive()}>
              I&apos;m here
            </button>
          )}
          {room && isHost && formed && !room.proofFlow && (
            <button className="btn btn-p" type="button" disabled={busy || presentIds.length === 0} onClick={() => void checkIn()}>
              {presentIds.length === 0 ? "Tick who's here to check in" : `Check in ${presentIds.length + 1} people`}
            </button>
          )}
          {room && met && (
            <a className="btn btn-p" href={`/app/feedback?id=${room.rallyId}`}>
              {room.proofFlow ? "Leave an optional vouch" : "We’re done · how did it go?"}
            </a>
          )}
          {room && (
            <p style={{ margin: "4px 0 0", fontSize: "13px", lineHeight: 1.4, color: "#766B65", textAlign: "center" }}>
              {room.proofFlow
                ? met ? "Photos and vouches are optional. Your Rally is already completed." : "Your Rally completes automatically after the activity. No check-in is needed."
                : met
                ? "Check-in is confirmed by the host, not proof of attendance."
                : isHost
                ? "Anyone you don't tick is marked as a no-show."
                : "The host checks everyone in at the meeting point."}
            </p>
          )}
          {room && !room.proofFlow && reporting && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
              <Dropdown
                ariaLabel="Who is this about?"
                placeholder="Who is this about?"
                value={reportWho}
                options={others.map((m) => ({ value: m.userId, label: m.displayName ?? "Rally member" }))}
                onChange={setReportWho}
              />
              <Dropdown
                ariaLabel="What kind of problem?"
                value={reportKind}
                options={[
                  { value: "misconduct", label: "Their behaviour" },
                  { value: "false_checkin", label: "Check-in was wrong" },
                  { value: "other", label: "Something else" },
                ]}
                onChange={(v) => setReportKind(v as DisputeCategory)}
              />
              <textarea
                aria-label="What happened?"
                placeholder="What happened? Only Rally's team reads this."
                maxLength={1000}
                rows={3}
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                style={{ ...fieldStyle, height: "auto", padding: "12px" }}
              />
              <button className="btn btn-p" type="button" disabled={busy || !reportWho || !reportText.trim()} onClick={() => void report()}>
                Send report
              </button>
            </div>
          )}
          {reported && (
            <p role="status" style={{ margin: "4px 0 0", fontSize: "13px", color: "#766B65", textAlign: "center" }}>
              Report sent. The person won&apos;t see who sent it.
            </p>
          )}
          {room && !room.proofFlow && others.length > 0 && !reporting && (
            <div className="sub">
              <button type="button" onClick={() => setReporting(true)}>
                Report a problem
              </button>
            </div>
          )}
          {room && formed && (
            <div className="sub">
              <button type="button" disabled={busy} onClick={() => void leave()}>
                {confirmLeave ? "Tap again to confirm" : isHost ? "Cancel this Rally" : "Leave this Rally"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
