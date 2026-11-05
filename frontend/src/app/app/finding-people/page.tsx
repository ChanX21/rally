"use client";

import { useEffect, useState } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import RallyOrb, { type OrbVariant } from "@/components/RallyOrb";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

const LABELS = [
  { label: "Understood your plan", tag: "0G" },
  { label: "Checked live plans nearby", tag: "Arkiv" },
  { label: "Checking time, place and seats", tag: "Rules" },
  { label: "Composing a group", tag: "0G" },
];

export default function FindingPeopleScreen() {
  // One run, never a loop. The happy path: match / AI fallback / taking longer / failed with
  // retry / honest no-match are all reachable states; this screen runs the "match" scenario.
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStage((s) => {
        const next = s + 1;
        if (next >= 4) clearInterval(timer);
        return next;
      });
    }, 1300);
    return () => clearInterval(timer);
  }, []);

  const active = Math.min(stage, 2) + 2; // 2, 3, 4 (4 = all done)
  const settled = stage >= 2;

  const steps = LABELS.map((l, i) => {
    const done = i < active;
    const isActive = i === active;
    const pending = !done && !isActive;
    return { label: l.label, tag: l.tag, done, active: isActive, pending };
  });

  const title1 = settled ? "Found" : "Finding";
  const title2 = settled ? "" : "your people";
  const sub = settled ? "A group that fits your plan is ready." : "Usually under 30 seconds. You can leave this screen; we'll put the result in your inbox.";
  const orbVariant: OrbVariant = "active";

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
        .btn-s { background: transparent; border: 1px solid #D9C8BE; color: #1C1917; }
        .btn-s:hover { border-color: #1C1917; color: #1C1917; }
        .btn:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .lnk { display: flex; align-items: center; justify-content: center; height: 44px; font-size: 15px; font-weight: 500; }
        .foot { padding: 12px 24px 32px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; min-height: 152px; box-sizing: border-box; justify-content: flex-end; }
        .step { display: flex; align-items: center; gap: 16px; min-height: 48px; font-size: 15px; }
        .mark { width: 24px; height: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: #FFF5EF; }
        .breathe { animation: breathe 2.6s ease-in-out infinite; }
        @keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .rise { animation: rise .4s ease-out both; }
        @keyframes rise { from { transform: translateY(16px); opacity: 0; } }
        .orbit { animation: orbit 6s linear infinite; transform-origin: 50% 50%; }
        @keyframes orbit { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .breathe, .spin, .rise, .orbit { animation: none; } }
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
          <span style={{ width: "44px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="mono" style={{ color: "#1C1917" }}>
              Step 2 of 2
            </span>
            <span style={{ display: "flex", gap: "4px" }}>
              <span style={{ width: "24px", height: "4px", borderRadius: "2px", background: "#315FE8" }} />
              <span style={{ width: "24px", height: "4px", borderRadius: "2px", background: "#315FE8" }} />
            </span>
          </div>
          <span style={{ width: "44px" }} />
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 24px 0", overflow: "hidden" }}>
          <div style={{ position: "relative", width: "240px", height: "240px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg className="orbit" width="240" height="240" viewBox="0 0 240 240" aria-hidden="true" style={{ position: "absolute", left: 0, top: 0 }}>
              <circle cx="120" cy="120" r="114" fill="none" stroke="#766B65" strokeWidth="0.75" strokeDasharray="0.75 6" strokeLinecap="round" />
            </svg>
            <div className="breathe">
              <RallyOrb variant={orbVariant} size={188} />
            </div>
          </div>
          <h1 className="h1" style={{ marginTop: "24px", textAlign: "center" }}>
            {title1} <span className="em">{title2}</span>
          </h1>
          <p role="status" style={{ margin: "8px 0 0", maxWidth: "310px", fontSize: "14px", lineHeight: 1.45, color: "#766B65", textAlign: "center" }}>
            {sub}
          </p>

          <ol
            style={{
              listStyle: "none",
              margin: "24px 0 0",
              padding: 0,
              width: "100%",
              backgroundImage: "linear-gradient(#D9C8BE, #D9C8BE)",
              backgroundSize: "1px calc(100% - 48px)",
              backgroundPosition: "11.5px 24px",
              backgroundRepeat: "no-repeat",
            }}
          >
            {steps.map((st) => (
              <li key={st.label} className="step" style={st.active ? { fontWeight: 600 } : st.pending ? { color: "#766B65" } : undefined}>
                <span className="mark">
                  {st.done && (
                    <span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#1C1917", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFF5EF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                  )}
                  {st.active && (
                    <svg className="spin" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" fill="#FFF5EF" stroke="#F8DDD3" strokeWidth="3" />
                      <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="#F06445" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  )}
                  {st.pending && <span style={{ width: "24px", height: "24px", borderRadius: "50%", border: "1.5px dashed #766B65", boxSizing: "border-box", background: "#FFF5EF" }} />}
                </span>
                <span style={{ flex: 1 }}>{st.label}</span>
                <span className="mono">{st.tag}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="foot">
          {settled && (
            <a className="btn btn-p rise" href="/app/match-found">
              See your match
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
          )}
          {!settled && (
            <a className="lnk" href="/app/home">
              Cancel search
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
