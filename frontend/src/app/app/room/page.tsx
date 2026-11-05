"use client";

import { useState } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

type Stage = "confirming" | "formed" | "checked-in";

export default function RoomScreen() {
  // QUORUM_READY (confirm the time) -> ROOM_FORMED (exact spot + brief) -> checked in (host-attested).
  const [stage, setStage] = useState<Stage>("confirming");
  const confirming = stage === "confirming";
  const formed = !confirming;
  const checkedIn = stage === "checked-in";
  const canCheckIn = stage === "formed";

  const crew = [
    { init: "You", name: "You", role: "Any role", mine: true },
    { init: "AM", name: "Aarav", role: "Solidity dev · Host", mine: false },
    { init: "RK", name: "Riya", role: "Designer", mine: false },
  ].map((m) => {
    let status = "Confirmed";
    if (confirming) status = m.mine ? "Accepted" : "Confirmed";
    if (checkedIn) status = m.mine ? "Checked in" : "Confirmed";
    return { ...m, status, ok: status !== "Accepted" };
  });

  const kicker = confirming ? "Everyone accepted" : checkedIn ? "You're checked in" : "Room formed";
  const title1 = confirming ? "Confirm" : "Your Rally";
  const title2 = confirming ? "the time" : "is on";
  const footNote = confirming
    ? "Aarav and Riya have confirmed. The room forms when you do."
    : checkedIn
    ? "Check-in is confirmed by the host, not proof of attendance."
    : "Aarav shows a short code at the table. Enter it to check in.";

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 0" }}
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
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .foot { padding: 12px 24px 32px; display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
        .sub { display: flex; justify-content: center; gap: 24px; }
        .sub a { display: flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 500; }
        .mem { display: flex; align-items: center; gap: 12px; min-height: 52px; border-top: 1px solid #D9C8BE; padding: 0 16px; }
        .mem:first-child { border-top: 0; }
        .av { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: #FFF5EF; background: #1C1917; flex-shrink: 0; }
        .av.you { background: #315FE8; }
        .rise { animation: rise .4s ease-out both; }
        @keyframes rise { from { transform: translateY(12px); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .rise { animation: none; } }
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
            Coffee break · 16:40
          </span>
          <span style={{ width: "44px" }} />
        </div>

        <div style={{ flex: 1, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "20px", overflow: "hidden" }}>
          <div>
            <div className="mono" style={{ color: "#1C1917" }}>
              {kicker}
            </div>
            <h1 className="hero" style={{ marginTop: "12px" }}>
              {title1} <span className="em">{title2}</span>
            </h1>
          </div>

          <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
              <span style={{ fontFamily: MONO, fontSize: "15px", fontWeight: 500 }}>16:40 – 17:00</span>
              <span style={{ fontSize: "13px", color: "#766B65" }}>Host: Aarav</span>
            </div>
            {formed ? (
              <div className="rise" style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#315FE8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }}>
                  <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 600 }}>Food court, table by the chai counter</div>
                  <div style={{ marginTop: "2px", fontSize: "13px", color: "#766B65" }}>Only the three of you can see this.</div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "12px", alignItems: "center", fontSize: "14px", color: "#766B65" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                Food court. The exact spot unlocks once everyone confirms.
              </div>
            )}
          </div>

          <div>
            <div className="mono">Your crew</div>
            <div className="card" style={{ marginTop: "8px" }}>
              {crew.map((m) => (
                <div key={m.init} className="mem">
                  <span className={`av${m.mine ? " you" : ""}`}>{m.init}</span>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "15px", fontWeight: 600 }}>{m.name}</span>
                    <span style={{ fontSize: "13px", color: "#766B65" }}>{m.role}</span>
                  </span>
                  <span style={{ fontSize: "13px", fontWeight: m.ok ? 600 : 400, color: m.ok ? "#1C1917" : "#766B65" }}>{m.status}</span>
                </div>
              ))}
            </div>
          </div>

          {formed && (
            <div className="rise" style={{ padding: "16px", borderRadius: "16px", background: "#F8DDD3" }}>
              <div className="mono" style={{ color: "#1C1917" }}>
                First five minutes · brief by 0G AI
              </div>
              <p style={{ margin: "8px 0 0", fontSize: "15px", lineHeight: 1.45 }}>
                Grab a drink, then each share one thing you learned at the 0G workshop and one thing you&apos;re still stuck on.
              </p>
            </div>
          )}
        </div>

        <div className="foot">
          {confirming && (
            <button className="btn btn-p" type="button" onClick={() => setStage("formed")}>
              Confirm 16:40
            </button>
          )}
          {canCheckIn && (
            <button className="btn btn-p" type="button" onClick={() => setStage("checked-in")}>
              Check in at the table
            </button>
          )}
          {checkedIn && (
            <a className="btn btn-p rise" href="/app/feedback">
              We&apos;re done · how did it go?
            </a>
          )}
          <p style={{ margin: "4px 0 0", fontSize: "13px", lineHeight: 1.4, color: "#766B65", textAlign: "center" }}>{footNote}</p>
          <div className="sub">
            <a href="/app/home">Leave this Rally</a>
            <a href="/app/home">Report a problem</a>
          </div>
        </div>
      </div>
    </div>
  );
}
