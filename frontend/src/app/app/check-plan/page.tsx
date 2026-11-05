"use client";

import { useState } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

type QuestionDef = { id: "when" | "far" | "vibe"; tag: string; text: string; options: Array<[string, string]> };

const QUESTIONS: QuestionDef[] = [
  { id: "when", tag: "01 · Timing", text: "Now or within the next hour?", options: [["now", "Now"], ["hour", "Within the next hour"]] },
  { id: "far", tag: "02 · Constraints", text: "How far are you willing to go?", options: [["near", "Stay in the venue"], ["any", "Venue and nearby"]] },
  { id: "vibe", tag: "03 · Group fit", text: "Quiet hangout or chatty group?", options: [["quiet", "Quiet hangout"], ["chatty", "Chatty group"]] },
];

export default function CheckPlanScreen() {
  // Workflow B: 0G asks at most three questions, only ones that change matching (Timing, Constraints,
  // Group fit, in the playbook's wording). sensitive plans default to private and are never offered
  // for the public board.
  const [step, setStep] = useState<"questions" | "review">("questions");
  const [answers, setAnswers] = useState<Record<string, string>>({ when: "hour", far: "near", vibe: "chatty" });
  const sensitive = false;

  const asking = step === "questions";

  const fields = [
    { label: "Activity", value: "Coffee break" },
    { label: "Role", value: "Any role" },
    { label: "When", value: answers.when === "now" ? "Now, 16:15 – 17:00" : "Today, 16:30 – 17:15" },
    { label: "How long", value: "20 min" },
    { label: "Group", value: "2 – 3 people" },
    { label: "Where", value: answers.far === "any" ? "Venue and nearby" : "Food court, in the venue" },
    { label: "Vibe", value: answers.vibe === "quiet" ? "Quiet hangout" : "Chatty group" },
  ];

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
        .foot { padding: 16px 24px 32px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; }
        .fld { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 0 16px; border: 0; border-top: 1px solid #D9C8BE; background: transparent; font-family: inherit; color: #1C1917; text-align: left; cursor: pointer; box-sizing: border-box; transition: background .12s ease-out; }
        .fld:first-child { border-top: 0; }
        .fld:hover { background: #E5ECFF; }
        .chip { display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid #D9C8BE; background: #FFFAF7; font-family: inherit; font-size: 14px; font-weight: 500; color: #1C1917; cursor: pointer; box-sizing: border-box; transition: border-color .12s ease-out, background .12s ease-out; }
        .chip:hover { border-color: #1C1917; }
        .chip:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .cb { position: relative; width: 22px; height: 22px; flex-shrink: 0; }
        .cb input { appearance: none; -webkit-appearance: none; width: 22px; height: 22px; margin: 0; border-radius: 6px; border: 1.5px solid #766B65; background: #FFFAF7; cursor: pointer; }
        .cb input:checked { background: #1C1917; border-color: #1C1917; }
        .cb svg { position: absolute; left: 4px; top: 4px; opacity: 0; pointer-events: none; }
        .cb input:checked + svg { opacity: 1; }
        .cb input:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
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
          <a className="ib" href="/app/home" aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="mono" style={{ color: "#1C1917" }}>
              Step 1 of 2
            </span>
            <span style={{ display: "flex", gap: "4px" }}>
              <span style={{ width: "24px", height: "4px", borderRadius: "2px", background: "#315FE8" }} />
              <span style={{ width: "24px", height: "4px", borderRadius: "2px", background: "#D9C8BE" }} />
            </span>
          </div>
          <span style={{ width: "44px" }} />
        </div>

        <div style={{ flex: 1, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "20px", overflow: "hidden" }}>
          <h1 className="h1">
            {asking ? "Three quick" : "Check"} <span className="em">{asking ? "questions" : "your plan"}</span>
          </h1>

          <div
            style={{
              alignSelf: "flex-end",
              maxWidth: "84%",
              padding: "12px 16px",
              borderRadius: "16px 16px 4px 16px",
              background: "#1C1917",
              color: "#FFF5EF",
              fontSize: "15px",
              lineHeight: 1.45,
            }}
          >
            Need someone to grab coffee with after the 0G workshop, like 20 mins
          </div>

          {asking && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {QUESTIONS.map((q) => (
                <fieldset key={q.id} style={{ margin: 0, padding: 0, border: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <legend className="mono" style={{ padding: 0, marginBottom: "8px" }}>
                    {q.tag}
                  </legend>
                  <span style={{ fontSize: "16px", fontWeight: 600 }}>{q.text}</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {q.options.map(([v, label]) => {
                      const pressed = answers[q.id] === v;
                      return (
                        <button
                          key={v}
                          className="chip"
                          type="button"
                          aria-pressed={pressed}
                          onClick={() => setAnswers({ ...answers, [q.id]: v })}
                          style={pressed ? { border: "1.5px solid #315FE8", background: "#E5ECFF" } : undefined}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
              <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.45, color: "#766B65" }}>
                0G only asks what changes who you&apos;re matched with. Never more than three.
              </p>
            </div>
          )}

          {!asking && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="mono">Rally understood</span>
                <span className="mono" style={{ color: "#315FE8" }}>
                  Tap to edit
                </span>
              </div>
              <div className="card" style={{ marginTop: "8px", overflow: "hidden" }}>
                {fields.map((f) => (
                  <button key={f.label} className="fld" type="button">
                    <span style={{ width: "80px", fontSize: "13px", color: "#766B65" }}>{f.label}</span>
                    <span style={{ flex: 1, fontSize: "15px", fontWeight: 500 }}>{f.value}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#766B65" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="foot">
          {asking && (
            <button className="btn btn-p" type="button" onClick={() => setStep("review")} style={{ width: "100%", border: 0, fontFamily: "inherit", cursor: "pointer" }}>
              Continue
            </button>
          )}
          {!asking && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {sensitive ? (
                <div style={{ display: "flex", gap: "12px", fontSize: "13px", lineHeight: 1.4, color: "#766B65" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  <span>
                    <strong style={{ fontWeight: 600, color: "#1C1917" }}>This plan stays private.</strong> Plans like this never go on the live board.
                  </span>
                </div>
              ) : (
                <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
                  <span className="cb" style={{ marginTop: "1px" }}>
                    <input type="checkbox" />
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFF5EF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600 }}>Show this plan on the live board</span>
                    <span style={{ fontSize: "13px", lineHeight: 1.4, color: "#766B65" }}>Only activity, area and time. No name or wallet. Ends at 6 PM.</span>
                  </span>
                </label>
              )}
              <a className="btn btn-p" href="/app/finding-people">
                Confirm and find company
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            </div>
          )}
          <div className="mono" style={{ textAlign: "center" }}>
            Read by 0G AI · 1.2 s · req 0g-91b4e0
          </div>
        </div>
      </div>
    </div>
  );
}
