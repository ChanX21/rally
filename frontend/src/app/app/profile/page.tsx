"use client";

import { useState } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

export default function ProfileScreen() {
  // Private profile: display name, top interests, what the user told Rally, and the matching switch.
  const [name, setName] = useState("Divyanshi");

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .ib { width: 44px; height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 1px solid #D9C8BE; border-radius: 50%; background: #FFFAF7; color: #1C1917; flex-shrink: 0; }
        .ib:hover { border-color: #1C1917; color: #1C1917; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .h1 { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 30px; line-height: 1.08; letter-spacing: -.01em; }
        .em { font-style: italic; color: #315FE8; }
        .card { background: #FFFAF7; border: 1px solid #D9C8BE; border-radius: 16px; }
        .tag { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; border-radius: 999px; font-size: 14px; font-weight: 500; box-sizing: border-box; }
        .head { display: flex; justify-content: space-between; align-items: baseline; }
        .head a { font-size: 14px; font-weight: 600; color: #315FE8; min-height: 32px; display: flex; align-items: center; }
        .sw { appearance: none; -webkit-appearance: none; width: 52px; height: 32px; margin: 0; border-radius: 999px; background: #E8DFDA; position: relative; cursor: pointer; flex-shrink: 0; transition: background .15s ease-out; }
        .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%; background: #FFFAF7; transition: transform .15s ease-out; }
        .sw:checked { background: #1C1917; }
        .sw:checked::after { transform: translateX(20px); }
        .sw:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        input[type=text]:focus { border: 1.5px solid #315FE8 !important; }
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "64px", padding: "12px 24px 0", boxSizing: "border-box", flexShrink: 0 }}>
          <a className="ib" href="/app/home" aria-label="Back to home">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </a>
          <span className="mono" style={{ color: "#1C1917" }}>
            Only you see this
          </span>
          <span style={{ width: "44px" }} />
        </div>

        <div style={{ flex: 1, padding: "20px 24px 0", display: "flex", flexDirection: "column", gap: "24px", overflow: "hidden" }}>
          <div>
            <h1 className="h1">
              Your <span className="em">Rally profile</span>
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.45, color: "#766B65" }}>
              Shapes who Rally proposes to you. It&apos;s never a public profile.
            </p>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span className="mono">Your name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="given-name"
              style={{
                width: "100%",
                height: "52px",
                padding: "0 16px",
                borderRadius: "16px",
                border: "1px solid #D9C8BE",
                background: "#FFFAF7",
                fontFamily: "inherit",
                fontSize: "16px",
                fontWeight: 500,
                color: "#1C1917",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <span style={{ fontSize: "13px", color: "#766B65" }}>Shown to people in your Rally. Never your wallet.</span>
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="head">
              <span className="mono">Top interests</span>
              <a href="/app/about-you">Edit</a>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <span className="tag" style={{ background: "#E5ECFF" }}>
                Coffee
              </span>
              <span className="tag" style={{ background: "#E5ECFF" }}>
                Build
              </span>
              <span className="tag" style={{ background: "#E5ECFF" }}>
                Workshop
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="mono">You told us</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <span className="tag" style={{ border: "1px solid #D9C8BE" }}>
                Frontend
              </span>
              <span className="tag" style={{ border: "1px solid #D9C8BE" }}>
                Free between sessions
              </span>
            </div>
          </div>

          <label className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 16px", cursor: "pointer" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "15px", fontWeight: 600 }}>Open to matches</span>
              <span style={{ fontSize: "13px", color: "#766B65" }}>Rally always asks before adding you</span>
            </span>
            <input className="sw" type="checkbox" role="switch" defaultChecked />
          </label>
        </div>
        <div style={{ height: "28px", flexShrink: 0 }} />
      </div>
    </div>
  );
}
