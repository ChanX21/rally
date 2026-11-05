import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

const ITEMS = [
  { title: "We found a Rally that fits your plan", detail: "Coffee break · 16:40 · 1:24 left to reply", when: "Now", href: "/app/match-found", isNew: true },
  { title: "Aarav vouched for you", detail: '"Helped my pitch" · after Coffee break', when: "5 min", href: "/app/feedback", isNew: false },
  { title: "A Rally fits your interests", detail: "Workshop buddy · around 6 PM · from your top three", when: "8 min", href: "/app/match-found", isNew: false },
  { title: "Still looking? Your interest expires soon", detail: "Pitch practice · live until 18:00", when: "12 min", href: "/app/no-fit", isNew: false },
  { title: "A spot reopened. Interested?", detail: "Diya candle painting · 17:00", when: "25 min", href: "/app/check-plan", isNew: false },
  { title: "How did it go?", detail: "Workshop buddy · earlier today", when: "2 h", href: "/app/feedback", isNew: false },
];

export default function InboxScreen() {
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
        .note { display: flex; gap: 12px; padding: 16px; border-top: 1px solid #D9C8BE; text-decoration: none; color: #1C1917; transition: background .12s ease-out; }
        .note:first-child { border-top: 0; }
        .note:hover { background: #E5ECFF; color: #1C1917; }
        .sw { appearance: none; -webkit-appearance: none; width: 52px; height: 32px; margin: 0; border-radius: 999px; background: #E8DFDA; position: relative; cursor: pointer; flex-shrink: 0; transition: background .15s ease-out; }
        .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%; background: #FFFAF7; transition: transform .15s ease-out; }
        .sw:checked { background: #1C1917; }
        .sw:checked::after { transform: translateX(20px); }
        .sw:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
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
            1 new
          </span>
          <span style={{ width: "44px" }} />
        </div>

        <div style={{ flex: 1, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "24px", overflow: "hidden" }}>
          <div>
            <h1 className="hero">
              Your <span className="em">inbox</span>
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: "15px", lineHeight: 1.5, color: "#766B65" }}>
              Everything Rally needs you to see lands here, even if alerts are off.
            </p>
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            {ITEMS.map((n) => (
              <a key={n.title} className="note" href={n.href}>
                <span
                  style={
                    n.isNew
                      ? { width: "8px", height: "8px", marginTop: "7px", borderRadius: "50%", background: "#F06445", flexShrink: 0 }
                      : { width: "8px", height: "8px", marginTop: "7px", flexShrink: 0 }
                  }
                />
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "15px", fontWeight: n.isNew ? 600 : 400, lineHeight: 1.35 }}>{n.title}</span>
                  <span style={{ fontSize: "13px", color: "#766B65" }}>{n.detail}</span>
                </span>
                <span className="mono" style={{ flexShrink: 0 }}>
                  {n.when}
                </span>
              </a>
            ))}
          </div>

          <label className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "16px", cursor: "pointer" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "15px", fontWeight: 600 }}>Phone alerts</span>
              <span style={{ fontSize: "13px", lineHeight: 1.4, color: "#766B65" }}>
                For when Rally is closed. Your browser will ask first. On iPhone, add Rally to your home screen.
              </span>
            </span>
            <input className="sw" type="checkbox" role="switch" />
          </label>
        </div>
        <div style={{ height: "32px", flexShrink: 0 }} />
      </div>
    </div>
  );
}
