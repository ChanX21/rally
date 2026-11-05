import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import RallyOrb from "@/components/RallyOrb";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

const REASONS = [
  "All three of you are free 16:30 to 17:15",
  "You were all at the 0G workshop",
  "Food court is closest for everyone",
];

export default function MatchFoundScreen() {
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
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; height: 56px; border-radius: 999px; font-size: 16px; font-weight: 600; text-decoration: none; box-sizing: border-box; transition: transform .12s ease-out, background .12s ease-out, border-color .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .btn-s { border: 1px solid #D9C8BE; color: #1C1917; }
        .btn-s:hover { border-color: #1C1917; color: #1C1917; }
        .av { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; color: #FFF5EF; background: #1C1917; flex-shrink: 0; box-sizing: border-box; border: 2px solid #FFFAF7; }
        .av.you { background: #315FE8; }
        .foot { padding: 16px 24px 32px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; flex-shrink: 0; }
        .meta { display: flex; align-items: center; gap: 6px; font-size: 14px; }
        .pulse { animation: pulse 1.8s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: .35; } }
        @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
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
        <div aria-hidden="true" style={{ position: "absolute", right: "-56px", top: "52px" }}>
          <RallyOrb variant="celebration" size={196} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "64px", padding: "12px 24px 0", boxSizing: "border-box", flexShrink: 0, position: "relative", zIndex: 1 }}>
          <a className="ib" href="/app/finding-people" aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </a>
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
            1:24 TO REPLY
          </span>
        </div>

        <div style={{ flex: 1, padding: "32px 24px 0", display: "flex", flexDirection: "column", gap: "24px", overflow: "hidden", position: "relative" }}>
          <div>
            <div className="mono" style={{ color: "#1C1917" }}>
              Proposal · needs your answer
            </div>
            <h1 className="hero" style={{ marginTop: "12px", maxWidth: "220px" }}>
              You have been <span className="em">matched</span>
            </h1>
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ fontFamily: SERIF, fontSize: "24px", lineHeight: 1.1 }}>Coffee break</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                <span className="meta">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#766B65" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  <span style={{ fontFamily: MONO }}>16:40 · 20 min</span>
                </span>
                <span className="meta">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#766B65" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  Food court
                </span>
              </div>
            </div>
            <div style={{ padding: "16px", borderTop: "1px solid #D9C8BE", display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ display: "flex" }}>
                <span className="av you">You</span>
                <span className="av" style={{ marginLeft: "-10px" }}>
                  AM
                </span>
                <span className="av" style={{ marginLeft: "-10px" }}>
                  RK
                </span>
              </div>
              <div style={{ fontSize: "13px", lineHeight: 1.4 }}>
                <strong style={{ fontWeight: 600 }}>Needs 3 people · all found</strong>
                <br />
                <span style={{ color: "#766B65" }}>You, Aarav (Solidity dev) and Riya (designer)</span>
              </div>
            </div>
          </div>

          <div>
            <div className="mono">Why you fit</div>
            <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "12px", fontSize: "15px", lineHeight: 1.4 }}>
              {REASONS.map((r, i) => (
                <li key={r} style={{ display: "flex", gap: "12px" }}>
                  <span style={{ fontFamily: MONO, fontSize: "13px", color: "#315FE8", paddingTop: "1px" }}>{String(i + 1).padStart(2, "0")}</span>
                  {r}
                </li>
              ))}
            </ol>
            <div className="mono" style={{ marginTop: "12px" }}>
              Composed by 0G · checked by Rally · req 0g-7f3a2c
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "#766B65" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            The exact spot is shared once everyone accepts.
          </div>
          <p style={{ margin: "-12px 0 0", fontSize: "13px", lineHeight: 1.45, color: "#766B65" }}>
            No answer by the deadline counts as declining. The spot goes to someone else.
          </p>
        </div>

        <div className="foot">
          <a className="btn btn-s" href="/app/finding-people">
            Decline
          </a>
          <a className="btn btn-p" href="/app/room">
            Accept
          </a>
        </div>
      </div>
    </div>
  );
}
