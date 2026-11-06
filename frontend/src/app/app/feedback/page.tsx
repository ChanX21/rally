"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { errorCode, errorMessage } from "@/lib/api";
import { displayTime, initials } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";
import { RallyProof } from "@/components/RallyProof";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

const CONTRIBUTIONS = ["Helped my pitch", "Taught me something", "Great company"];

function Chip({ label, pressed, onClick, extra }: { label: React.ReactNode; pressed: boolean; onClick: () => void; extra?: React.ReactNode }) {
  return (
    <button
      className="chip"
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      style={pressed ? { border: "1.5px solid #315FE8", background: "#E5ECFF" } : undefined}
    >
      {extra}
      {label}
    </button>
  );
}

export default function FeedbackScreen() {
  // Attest -> vouch. A vouch names a specific contribution, only for other members of this Rally.
  const { api, me } = useSession();
  const router = useRouter();
  const rallyId = useSearchParams().get("id");
  const [happened, setHappened] = useState<"yes" | "no" | null>(null);
  const [useful, setUseful] = useState<"very" | "not" | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [rallyAgain, setRallyAgain] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Vouches and encores can only name people the host marked present.
  const load = useCallback(() => api.getRoom(rallyId ?? ""), [api, rallyId]);
  const { data: room, error, loaded } = usePolled(rallyId ? load : null);
  const others = room?.members.filter((m) => m.userId !== me?.user.id && (room?.proofFlow || m.checkedIn)) ?? [];

  const met = happened === "yes";

  const send = async () => {
    if (!rallyId || !happened) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.submitFeedback(
        rallyId,
        met
          ? {
              happened: true,
              useful: useful === null ? undefined : useful === "very",
              vouches: who && why ? [{ recipientId: who, contribution: why }] : [],
              encoreWith: others.filter((m) => rallyAgain[m.userId]).map((m) => m.userId),
            }
          : { happened: false }
      );
      router.replace("/app/profile");
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  };

  // Check-in decides who can answer: a no-show has lost access to the rally.
  const blocked = rallyId && loaded && !room;
  const blockedText = !rallyId
    ? "Open feedback from your inbox or your room."
    : errorCode(error) === "NOT_FOUND"
    ? "Only people marked present can leave feedback for this Rally."
    : errorCode(error) === "ROOM_LOCKED"
    ? "Feedback opens after the host has checked everyone in."
    : errorMessage(error);

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", height: "100dvh", display: "flex", justifyContent: "center", padding: "0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .ib { width: 44px; height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 1px solid #D9C8BE; border-radius: 50%; background: #FFFAF7; color: #1C1917; flex-shrink: 0; }
        .ib:hover { border-color: #1C1917; color: #1C1917; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .h1 { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 30px; line-height: 1.08; letter-spacing: -.01em; }
        .em { font-style: italic; color: #315FE8; }
        .chip { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid #D9C8BE; background: #FFFAF7; font-family: inherit; font-size: 14px; font-weight: 500; color: #1C1917; cursor: pointer; box-sizing: border-box; transition: border-color .12s ease-out, background .12s ease-out; }
        .chip:hover { border-color: #1C1917; }
        .chip:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 56px; border: 0; border-radius: 999px; font-family: inherit; font-size: 16px; font-weight: 600; text-decoration: none; box-sizing: border-box; cursor: pointer; transition: transform .12s ease-out, background .12s ease-out; }
        .btn:disabled { background: #E8DFDA; color: #766B65; cursor: not-allowed; }
        .btn:active { transform: scale(.97); }
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .av { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: #FFF5EF; background: #1C1917; flex-shrink: 0; }
        .mem { display: flex; align-items: center; gap: 12px; min-height: 52px; border-top: 1px solid #D9C8BE; cursor: pointer; }
        .cb { position: relative; width: 24px; height: 24px; flex-shrink: 0; }
        .cb input { appearance: none; -webkit-appearance: none; width: 24px; height: 24px; margin: 0; border-radius: 7px; border: 1.5px solid #766B65; background: #FFFAF7; cursor: pointer; }
        .cb input:checked { background: #315FE8; border-color: #315FE8; }
        .cb svg { position: absolute; left: 5px; top: 5px; opacity: 0; pointer-events: none; }
        .cb input:checked + svg { opacity: 1; }
        .cb input:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .sec { display: flex; flex-direction: column; gap: 8px; }
        .foot { padding: 12px 24px 28px; display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
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
          borderRadius: "36px",
          boxShadow: "0 1px 3px rgba(0,0,0,.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "64px", padding: "12px 24px 0", boxSizing: "border-box", flexShrink: 0 }}>
          <a className="ib" href={rallyId ? `/app/room?id=${rallyId}` : "/app/home"} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </a>
          <span className="mono" style={{ color: "#1C1917", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "240px" }}>
            {room ? `${room.goal} · ${displayTime(room.windowStart)}` : "Feedback"}
          </span>
          <span style={{ width: "44px" }} />
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "20px 24px 0", display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto" }}>
          <h1 className="h1">
            How did <span className="em">it go?</span>
          </h1>

          {(blocked || !rallyId) && (
            <p role="alert" style={{ margin: 0, fontSize: "15px", lineHeight: 1.45, color: "#766B65" }}>
              {blockedText}
            </p>
          )}

          {room && <fieldset className="sec" style={{ margin: 0, padding: 0, border: 0 }}>
            <legend className="mono" style={{ padding: 0, marginBottom: "8px" }}>
              Did it happen?
            </legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
              <Chip label="Yes, we met" pressed={happened === "yes"} onClick={() => setHappened("yes")} />
              <Chip label="No, it didn't" pressed={happened === "no"} onClick={() => setHappened("no")} />
            </div>
          </fieldset>}

          {room && met && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <fieldset className="sec" style={{ margin: 0, padding: 0, border: 0 }}>
                <legend className="mono" style={{ padding: 0, marginBottom: "8px" }}>
                  Was it useful?
                </legend>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                  <Chip label="Yes, useful" pressed={useful === "very"} onClick={() => setUseful(useful === "very" ? null : "very")} />
                  <Chip label="Not really" pressed={useful === "not"} onClick={() => setUseful(useful === "not" ? null : "not")} />
                </div>
              </fieldset>

              <fieldset className="sec" style={{ margin: 0, padding: 0, border: 0 }}>
                <legend className="mono" style={{ padding: 0, marginBottom: "8px" }}>
                  Vouch for someone · optional
                </legend>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {others.map((m) => (
                    <Chip
                      key={m.userId}
                      label={m.displayName ?? "Rally member"}
                      pressed={who === m.userId}
                      onClick={() => setWho(who === m.userId ? null : m.userId)}
                      extra={
                        <span className="av" style={{ width: "24px", height: "24px", fontSize: "10px" }}>
                          {initials(m.displayName)}
                        </span>
                      }
                    />
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {CONTRIBUTIONS.map((c) => (
                    <Chip key={c} label={c} pressed={why === c} onClick={() => setWhy(why === c ? null : c)} />
                  ))}
                </div>
                <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.4, color: "#766B65" }}>
                  Helps Rally suggest better groups. It&apos;s not a payout, and you can&apos;t vouch for yourself.
                </p>
              </fieldset>

              <div className="sec">
                <div className="mono">Rally again with · private</div>
                <div style={{ borderBottom: "1px solid #D9C8BE" }}>
                  {others.map((m) => (
                    <label key={m.userId} className="mem">
                      <span className="av">{initials(m.displayName)}</span>
                      <span style={{ flex: 1, fontSize: "15px", fontWeight: 600 }}>{m.displayName ?? "Rally member"}</span>
                      <span className="cb">
                        <input
                          type="checkbox"
                          checked={rallyAgain[m.userId] ?? false}
                          onChange={(e) => setRallyAgain({ ...rallyAgain, [m.userId]: e.target.checked })}
                        />
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFF5EF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </span>
                    </label>
                  ))}
                </div>
                <p style={{ margin: 0, fontSize: "12px", color: "#766B65" }}>They only find out if they pick you too.</p>
              </div>

              {room.proofFlow && rallyId && (
                <div className="sec">
                  <div className="mono" style={{ marginBottom: "8px" }}>Add rally photos · optional</div>
                  <RallyProof key={rallyId} rallyId={rallyId} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="foot">
          {actionError && (
            <p role="alert" style={{ margin: "0 0 8px", fontSize: "13px", lineHeight: 1.4, color: "#EC562E", textAlign: "center" }}>
              {actionError}
            </p>
          )}
          {room && (
            <button className="btn btn-p" type="button" disabled={busy || !happened} onClick={() => void send()}>
              {busy ? "Sending…" : "Send feedback"}
            </button>
          )}
          <a href="/app/home" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "44px", fontSize: "15px", fontWeight: 500 }}>
            Skip for now
          </a>
        </div>
      </div>
    </div>
  );
}
