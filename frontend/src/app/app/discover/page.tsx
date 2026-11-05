"use client";

import { useState } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

type Card = {
  title: string;
  zone: string;
  time: string;
  conf: number;
  int: number;
  why: string;
};

const DATA: Card[] = [
  {
    title: "Exploring the candle workshop",
    zone: "Activities",
    time: "around 5 PM",
    conf: 2,
    int: 2,
    why: "A slow half hour away from the screen. Two people already said yes.",
  },
  {
    title: "Up for a coffee break",
    zone: "Food court",
    time: "4 to 5 PM",
    conf: 0,
    int: 3,
    why: "Starts as the 0G workshop ends. Compare notes with people who were there.",
  },
  {
    title: "Rallying for pitch practice",
    zone: "Main hall",
    time: "around 6 PM",
    conf: 1,
    int: 1,
    why: "Quick run-throughs with honest feedback before judging.",
  },
];

const WANDER_DOTS: Array<{ cls: "w1" | "w2" | "w3" | "w4"; cx: number; cy: number; dur: string; delay: string }> = [
  { cls: "w1", cx: 46.6, cy: 28.5, dur: "9.9s", delay: "-2.4s" },
  { cls: "w2", cx: 80.5, cy: 27.7, dur: "5.4s", delay: "-3.8s" },
  { cls: "w3", cx: 50.6, cy: 28.7, dur: "8.9s", delay: "-1.6s" },
  { cls: "w4", cx: 121.2, cy: 28.1, dur: "5.4s", delay: "-2.0s" },
  { cls: "w1", cx: 143.5, cy: 30.3, dur: "9.8s", delay: "-4.5s" },
  { cls: "w2", cx: 198.9, cy: 18.1, dur: "5.6s", delay: "-1.5s" },
  { cls: "w3", cx: 198.5, cy: 28.2, dur: "5.5s", delay: "-0.4s" },
  { cls: "w4", cx: 268.4, cy: 12.8, dur: "9.0s", delay: "-1.1s" },
  { cls: "w1", cx: 301.9, cy: 31.3, dur: "7.8s", delay: "-2.7s" },
  { cls: "w2", cx: 61.1, cy: 71.2, dur: "6.0s", delay: "-4.4s" },
  { cls: "w3", cx: 25.3, cy: 54.4, dur: "5.7s", delay: "-3.9s" },
  { cls: "w4", cx: 52.0, cy: 55.7, dur: "5.6s", delay: "-2.5s" },
  { cls: "w1", cx: 27.7, cy: 117.0, dur: "6.1s", delay: "-1.6s" },
  { cls: "w2", cx: 16.2, cy: 117.9, dur: "9.9s", delay: "-4.8s" },
  { cls: "w3", cx: 45.7, cy: 119.4, dur: "6.5s", delay: "-5.3s" },
  { cls: "w4", cx: 51.4, cy: 118.6, dur: "6.1s", delay: "-2.4s" },
  { cls: "w1", cx: 164.0, cy: 100.4, dur: "9.3s", delay: "-3.9s" },
  { cls: "w2", cx: 159.6, cy: 80.5, dur: "5.5s", delay: "-5.9s" },
  { cls: "w3", cx: 215.8, cy: 117.8, dur: "6.1s", delay: "-1.5s" },
  { cls: "w4", cx: 199.4, cy: 102.8, dur: "8.9s", delay: "-2.0s" },
  { cls: "w1", cx: 144.8, cy: 77.9, dur: "6.5s", delay: "-0.4s" },
  { cls: "w2", cx: 142.1, cy: 69.7, dur: "5.5s", delay: "-3.5s" },
  { cls: "w3", cx: 289.5, cy: 86.8, dur: "6.2s", delay: "-3.6s" },
  { cls: "w4", cx: 294.5, cy: 86.1, dur: "6.9s", delay: "-2.7s" },
  { cls: "w1", cx: 52.3, cy: 155.4, dur: "9.8s", delay: "-2.9s" },
  { cls: "w2", cx: 80.0, cy: 152.8, dur: "7.9s", delay: "-5.2s" },
  { cls: "w3", cx: 291.1, cy: 153.9, dur: "5.9s", delay: "-0.9s" },
];

const HOTS = [
  { cx: 82, cy: 113, delay: "0.0s" },
  { cx: 76, cy: 26, delay: "0.7s" },
  { cx: 273, cy: 92, delay: "1.4s" },
];

export default function DiscoverScreen() {
  // Cards stay vague on purpose: activity in plain words, coarse zone, hour bucket, counts. No names.
  // Tapping a card opens why + a CTA that prefills the plan; it never joins anything.
  const [open, setOpen] = useState(1);

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .em { font-style: italic; color: #315FE8; }
        .card { background: #FFFAF7; border: 1px solid #D9C8BE; border-radius: 16px; transition: border-color .15s ease-out; }
        .act { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 64px; padding: 12px 16px; border: 0; border-radius: 16px; background: transparent; font-family: inherit; text-align: left; color: #1C1917; cursor: pointer; box-sizing: border-box; transition: background .12s ease-out; }
        .act:hover { background: #F7EEE9; }
        .act:focus-visible { outline: 2px solid #315FE8; outline-offset: -2px; }
        .stat { display: flex; align-items: center; justify-content: flex-end; gap: 6px; font-size: 12px; line-height: 1.3; }
        .dot { width: 9px; height: 9px; border-radius: 50%; box-sizing: border-box; flex-shrink: 0; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px; font-weight: 600; text-decoration: none; box-sizing: border-box; transition: transform .12s ease-out, background .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn-p { height: 52px; font-size: 16px; background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .btn-o { height: 40px; font-size: 14px; background: #315FE8; color: #FFF5EF; }
        .btn-o:hover { background: #2448C9; color: #FFF5EF; }
        .pulse { animation: pulse 1.8s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: .35; } }
        .halo { animation: halo 2.4s ease-out infinite; }
        @keyframes halo { 0% { transform: scale(.5); opacity: .35; } 100% { transform: scale(1.4); opacity: 0; } }
        .w1, .w2, .w3, .w4 { animation-timing-function: ease-in-out; animation-iteration-count: infinite; animation-direction: alternate; }
        .w1 { animation-name: w1; } @keyframes w1 { to { transform: translate(5px, 3px); } }
        .w2 { animation-name: w2; } @keyframes w2 { to { transform: translate(-5px, 3px); } }
        .w3 { animation-name: w3; } @keyframes w3 { to { transform: translate(4px, -4px); } }
        .w4 { animation-name: w4; } @keyframes w4 { to { transform: translate(-5px, -2px); } }
        @media (prefers-reduced-motion: reduce) { .pulse, .halo, .w1, .w2, .w3, .w4 { animation: none; } }
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
          borderRadius: "36px",
          boxShadow: "0 1px 3px rgba(0,0,0,.12)",
        }}
      >
        {/* Nav */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "56px",
            padding: "8px 24px 0",
            boxSizing: "border-box",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true">
              <circle cx="13" cy="13" r="11.5" fill="none" stroke="#1C1917" strokeWidth="1.5" />
              <circle cx="13" cy="8.6" r="2.3" fill="#1C1917" />
              <circle cx="8.8" cy="15.8" r="2.3" fill="#315FE8" />
              <circle cx="17.2" cy="15.8" r="2.3" fill="#F06445" />
            </svg>
            <span style={{ fontWeight: 600, fontSize: "16px", letterSpacing: "-0.01em" }}>Rally</span>
          </div>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              height: "28px",
              padding: "0 12px",
              border: "1px solid #D9C8BE",
              borderRadius: "999px",
            }}
          >
            <span className="pulse" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#F06445" }} />
            <span className="mono" style={{ color: "#1C1917" }}>
              Live · 16:12
            </span>
          </span>
        </div>

        {/* Title */}
        <div style={{ padding: "16px 24px 0", flexShrink: 0 }}>
          <div className="mono">ETHGlobal Mumbai</div>
          <h1
            style={{
              margin: "6px 0 0",
              fontFamily: SERIF,
              fontWeight: 400,
              fontSize: "30px",
              lineHeight: 1.05,
              letterSpacing: "-0.015em",
            }}
          >
            What people are <span className="em">rallying for</span>
          </h1>
        </div>

        {/* Live cards */}
        <div style={{ padding: "16px 24px 0", display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
          {DATA.map((c, i) => {
            const isOpen = open === i;
            return (
              <div key={c.title} className="card" style={isOpen ? { borderColor: "#315FE8" } : undefined}>
                <button
                  className="act"
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                    <span style={{ fontFamily: SERIF, fontSize: "19px", lineHeight: 1.15 }}>{c.title}</span>
                    <span style={{ fontSize: "13px", color: "#766B65" }}>
                      {c.zone} · <span style={{ fontFamily: MONO, color: "#1C1917" }}>{c.time}</span>
                    </span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "4px", flexShrink: 0 }}>
                    {c.conf > 0 && (
                      <span className="stat">
                        <span className="dot" style={{ background: "#1C1917" }} />
                        {c.conf} confirmed
                      </span>
                    )}
                    <span className="stat" style={{ color: "#766B65" }}>
                      <span className="dot" style={{ border: "1.5px dashed #766B65" }} />
                      {c.int} interested
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div
                    style={{
                      margin: "0 16px",
                      padding: "12px 0 16px",
                      borderTop: "1px solid #EADDD5",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.45 }}>{c.why}</p>
                    <a className="btn btn-o" href="/app/connect-wallet">
                      Start my plan from this
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Map */}
        <div style={{ flex: 1, minHeight: 0, padding: "16px 24px 0", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div className="card" style={{ padding: "12px" }}>
            <svg
              width="318"
              height="168"
              viewBox="0 0 318 168"
              role="img"
              aria-label="Venue map with live plans at the activities area, the food court and the main hall"
              style={{ display: "block", maxWidth: "100%" }}
            >
              <rect x="4" y="4" width="92" height="36" rx="6" fill="#F8DDD3" />
              <text x="12" y="17" fontFamily="IBM Plex Mono, monospace" fontSize="7.5" fontWeight={500} letterSpacing="0.6" fill="#5E5550">
                FOOD COURT
              </text>
              <rect x="102" y="4" width="70" height="36" rx="6" fill="#E8DFDA" />
              <text x="110" y="17" fontFamily="IBM Plex Mono, monospace" fontSize="7.5" fontWeight={500} letterSpacing="0.6" fill="#5E5550">
                WORKSHOPS
              </text>
              <rect x="178" y="4" width="136" height="36" rx="6" fill="#E5ECFF" />
              <rect x="4" y="46" width="92" height="44" rx="6" fill="#E5ECFF" />
              <rect x="4" y="96" width="92" height="30" rx="6" fill="#F8DDD3" />
              <text x="12" y="109" fontFamily="IBM Plex Mono, monospace" fontSize="7.5" fontWeight={500} letterSpacing="0.6" fill="#5E5550">
                ACTIVITIES
              </text>
              <rect x="102" y="46" width="124" height="80" rx="6" fill="#E5ECFF" />
              <text x="110" y="59" fontFamily="IBM Plex Mono, monospace" fontSize="7.5" fontWeight={500} letterSpacing="0.6" fill="#5E5550">
                HACKING
              </text>
              <rect x="232" y="46" width="82" height="80" rx="6" fill="#E8DFDA" />
              <text x="240" y="59" fontFamily="IBM Plex Mono, monospace" fontSize="7.5" fontWeight={500} letterSpacing="0.6" fill="#5E5550">
                MAIN HALL
              </text>
              <rect x="4" y="132" width="60" height="32" rx="6" fill="#E8DFDA" />
              <text x="12" y="145" fontFamily="IBM Plex Mono, monospace" fontSize="7.5" fontWeight={500} letterSpacing="0.6" fill="#5E5550">
                ENTRY
              </text>
              <rect x="70" y="132" width="74" height="32" rx="6" fill="#E8DFDA" />
              <text x="78" y="145" fontFamily="IBM Plex Mono, monospace" fontSize="7.5" fontWeight={500} letterSpacing="0.6" fill="#5E5550">
                MENTORS
              </text>
              <rect x="150" y="132" width="164" height="32" rx="6" fill="#E8DFDA" />
              <text x="158" y="145" fontFamily="IBM Plex Mono, monospace" fontSize="7.5" fontWeight={500} letterSpacing="0.6" fill="#5E5550">
                JUDGING
              </text>
              {WANDER_DOTS.map((d, i) => (
                <circle
                  key={i}
                  className={d.cls}
                  cx={d.cx}
                  cy={d.cy}
                  r="2.3"
                  fill="#1C1917"
                  style={{ animationDuration: d.dur, animationDelay: d.delay }}
                />
              ))}
              <g style={open === -1 ? { display: "none" } : undefined}>
                {HOTS.map((h, i) => (
                  <g key={i}>
                    <circle className="halo" cx={h.cx} cy={h.cy} r="12" fill="#F06445" style={{ transformOrigin: `${h.cx}px ${h.cy}px`, animationDelay: h.delay }} />
                    <circle cx={h.cx} cy={h.cy} r="8.5" fill="none" stroke="#315FE8" strokeWidth="2" style={{ opacity: open === i ? 1 : 0 }} />
                    <circle cx={h.cx} cy={h.cy} r="4" fill="#F06445" stroke="#FFFAF7" strokeWidth="1.5" />
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: "16px 24px 28px", display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
          <a className="btn btn-p" href="/app/home">
            Yes, let&apos;s Rally
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
          <p style={{ margin: 0, fontSize: "12px", color: "#766B65", textAlign: "center" }}>
            Preview only. No seat is held until you&apos;re matched.
          </p>
        </div>
      </div>
    </div>
  );
}
