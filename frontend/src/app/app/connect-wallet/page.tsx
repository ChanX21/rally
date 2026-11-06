import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import RallyOrb from "@/components/RallyOrb";
import WalletButtons from "@/components/WalletButtons";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

export default function ConnectWalletScreen() {
  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", height: "100dvh", display: "flex", justifyContent: "center", padding: "24px 0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .ib { width: 44px; height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 1px solid #D9C8BE; border-radius: 50%; background: #FFFAF7; color: #1C1917; position: relative; flex-shrink: 0; }
        .ib:hover { border-color: #1C1917; color: #1C1917; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .h1 { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 30px; line-height: 1.08; letter-spacing: -.01em; }
        .em { font-style: italic; color: #315FE8; }
        .wal { display: flex; align-items: center; gap: 12px; width: 100%; height: 64px; padding: 0 16px; border-radius: 16px; border: 1px solid #D9C8BE; background: #FFFAF7; font-size: 16px; font-weight: 600; font-family: inherit; text-align: left; cursor: pointer; text-decoration: none; color: #1C1917; box-sizing: border-box; transition: border-color .12s ease-out, background .12s ease-out, transform .12s ease-out; }
        .wal:hover { border-color: #315FE8; background: #E5ECFF; color: #1C1917; }
        .wal:active { transform: scale(.98); }
        .wal:disabled { opacity: .55; cursor: progress; }
        .wal:disabled:hover { border-color: #D9C8BE; background: #FFFAF7; }
        .logo { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .sheet { animation: rise .45s ease-out both; }
        @keyframes rise { from { transform: translateY(48px); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
      `}</style>

      <div
        style={{
          width: "390px",
          height: "844px",
          boxSizing: "border-box",
          background: "#FFF5EF",
          color: "#1C1917",
          fontFamily: SANS,
          overflow: "hidden",
          position: "relative",
          borderRadius: "36px",
          boxShadow: "0 1px 3px rgba(0,0,0,.12)",
        }}
      >
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "150px" }}>
          <RallyOrb variant="mono" size={184} />
          <div style={{ marginTop: "32px", fontFamily: SERIF, fontSize: "36px" }}>Let&apos;s rally for today</div>
        </div>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(28,25,23,0.45)" }} />

        <div
          className="sheet"
          role="dialog"
          aria-labelledby="sheetTitle"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            background: "#FFF5EF",
            borderRadius: "28px 28px 0 0",
            padding: "12px 24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <span style={{ alignSelf: "center", width: "36px", height: "4px", borderRadius: "2px", background: "#D9C8BE" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
            <div>
              <div className="mono">One step before we look</div>
              <h2 id="sheetTitle" className="h1" style={{ marginTop: "8px" }}>
                Connect to <span className="em">continue</span>
              </h2>
            </div>
            <a className="ib" href="/app/home" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </a>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <WalletButtons />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", paddingTop: "16px", borderTop: "1px solid #D9C8BE" }}>
            <div style={{ display: "flex", gap: "12px", fontSize: "14px", lineHeight: 1.45 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: "1px" }}>
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <span>
                <strong style={{ fontWeight: 600 }}>Private.</strong>{" "}
                <span style={{ color: "#766B65" }}>Your wallet and Google account are never shown to other people.</span>
              </span>
            </div>
            <div style={{ display: "flex", gap: "12px", fontSize: "14px", lineHeight: 1.45 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: "1px" }}>
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>
                <strong style={{ fontWeight: 600 }}>Free.</strong>{" "}
                <span style={{ color: "#766B65" }}>Nothing is charged. This just signs you in.</span>
              </span>
            </div>
          </div>
          <div className="mono" style={{ textAlign: "center" }}>
            Sign-in by Privy
          </div>
        </div>
      </div>
    </div>
  );
}
