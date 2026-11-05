"use client";

import { useState } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import RallyOrb from "@/components/RallyOrb";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

const ALTERNATIVES = [
  { title: "Snack run", place: "Food court", time: "16:45" },
  { title: "Pitch practice", place: "Main hall", time: "18:00" },
];

export default function NoFitScreen() {
  const [copied, setCopied] = useState(false);

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
        .h1 { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 30px; line-height: 1.08; letter-spacing: -.01em; }
        .em { font-style: italic; color: #315FE8; }
        .card { background: #FFFAF7; border: 1px solid #D9C8BE; border-radius: 16px; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; height: 56px; border-radius: 999px; font-size: 16px; font-weight: 600; text-decoration: none; box-sizing: border-box; transition: transform .12s ease-out, background .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .foot { padding: 16px 24px 32px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
        .alt { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; border-top: 1px solid #D9C8BE; text-decoration: none; color: #1C1917; }
        .alt:hover { color: #1C1917; }
        .alt:hover .go { color: #1C1917; }
        .sw { appearance: none; -webkit-appearance: none; width: 52px; height: 32px; margin: 0; border-radius: 999px; background: #E8DFDA; position: relative; cursor: pointer; flex-shrink: 0; transition: background .15s ease-out; }
        .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%; background: #FFFAF7; transition: transform .15s ease-out; }
        .sw:checked { background: #1C1917; }
        .sw:checked::after { transform: translateX(20px); }
        .sw:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .breathe { animation: breathe 4s ease-in-out infinite; }
        @keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
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

        <div style={{ flex: 1, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "24px", overflow: "hidden" }}>
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
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "#766B65" }}>
            Nobody else wants a coffee break in this window right now. We only look again when someone new joins or plans change.
          </p>

          <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: SERIF, fontSize: "20px" }}>Coffee break</span>
              <span style={{ fontFamily: MONO, fontSize: "13px" }}>until 6 PM</span>
            </div>
            <div>
              <div style={{ height: "6px", borderRadius: "3px", background: "#E5ECFF", overflow: "hidden" }}>
                <div style={{ width: "35%", height: "100%", borderRadius: "3px", background: "#315FE8" }} />
              </div>
              <div style={{ marginTop: "8px", display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#766B65" }}>
                <span>Looking for 23 min</span>
                <span>1 h 8 min left</span>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", paddingTop: "16px", borderTop: "1px solid #D9C8BE", cursor: "pointer" }}>
              <span>
                <span style={{ display: "block", fontSize: "15px", fontWeight: 600 }}>Keep this interest active until 6 PM?</span>
                <span style={{ display: "block", marginTop: "2px", fontSize: "13px", color: "#766B65" }}>You can stop any time</span>
              </span>
              <input className="sw" type="checkbox" role="switch" defaultChecked />
            </label>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", cursor: "pointer" }}>
              <span>
                <span style={{ display: "block", fontSize: "15px", fontWeight: 600 }}>Tell me when someone fits</span>
                <span style={{ display: "block", marginTop: "2px", fontSize: "13px", color: "#766B65" }}>In your Rally inbox. Phone alerts only if you allow them</span>
              </span>
              <input className="sw" type="checkbox" role="switch" defaultChecked />
            </label>
          </div>

          <div>
            <div className="mono">Or try a plan that&apos;s already live</div>
            <div style={{ marginTop: "8px" }}>
              {ALTERNATIVES.map((alt, i) => (
                <a key={alt.title} className="alt" href="/app/check-plan" style={i === ALTERNATIVES.length - 1 ? { borderBottom: "1px solid #D9C8BE" } : undefined}>
                  <span>
                    <span style={{ display: "block", fontSize: "15px", fontWeight: 600 }}>{alt.title}</span>
                    <span style={{ display: "block", marginTop: "2px", fontSize: "13px", color: "#766B65" }}>
                      {alt.place} · <span style={{ fontFamily: MONO }}>{alt.time}</span>
                    </span>
                  </span>
                  <span className="go" style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "14px", fontWeight: 600, color: "#315FE8" }}>
                    Use plan
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="foot">
          <a className="btn btn-p" href="/app/check-plan">
            Change my plan
          </a>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <button
              type="button"
              onClick={() => setCopied(true)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "44px", padding: 0, border: 0, background: "transparent", fontFamily: "inherit", fontSize: "15px", fontWeight: 500, color: "#1C1917", cursor: "pointer" }}
            >
              {copied ? "Invite link copied" : "Invite a friend to start it"}
            </button>
            <a href="/app/home" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "44px", fontSize: "15px", fontWeight: 500, color: "#766B65" }}>
              Stop looking
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
