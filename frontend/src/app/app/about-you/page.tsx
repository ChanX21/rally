"use client";

import { useCallback, useState } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { errorMessage, type CompleteOnboardingInput, type OnboardingQuestion } from "@/lib/api";
import { useSession } from "@/lib/session";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

type InterestId = "build" | "coffee" | "workshops" | "gaming" | "food" | "explore";

const CATALOG: Array<{ id: InterestId; label: string; hint: string }> = [
  { id: "build", label: "Build", hint: "Hack on something" },
  { id: "coffee", label: "Coffee", hint: "Short breaks" },
  { id: "workshops", label: "Workshop", hint: "Learn together" },
  { id: "gaming", label: "Gaming", hint: "Play between sprints" },
  { id: "food", label: "Food", hint: "Snack and meal runs" },
  { id: "explore", label: "Explore", hint: "See the venue and city" },
];

const ICONS: Record<InterestId, React.ReactNode> = {
  build: (
    <path d="M8.5 8L4.5 12l4 4M15.5 8l4 4-4 4M13.5 6l-3 12" />
  ),
  coffee: (
    <>
      <path d="M5 10h11v3.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" />
      <path d="M16 11.5h1.5a2.5 2.5 0 0 1 0 5H15.5" />
      <path d="M9 3.5c0 1.5 1.5 1.5 1.5 3M12.5 3.5c0 1.5 1.5 1.5 1.5 3" />
    </>
  ),
  workshops: (
    <>
      <rect x="4" y="4.5" width="16" height="10.5" rx="1.5" />
      <path d="M8 19.5l2-4.5M16 19.5l-2-4.5M7.5 8.5h9M7.5 11.5h5" />
    </>
  ),
  gaming: (
    <>
      <path d="M7 8.5h10a4 4 0 0 1 4 4v1.2a3 3 0 0 1-5.3 1.9l-1.4-1.6H9.7l-1.4 1.6A3 3 0 0 1 3 13.7v-1.2a4 4 0 0 1 4-4z" />
      <path d="M7.5 11v3M6 12.5h3" />
      <circle cx="15.5" cy="11.5" r="0.6" />
      <circle cx="17.5" cy="13.5" r="0.6" />
    </>
  ),
  food: (
    <>
      <path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0z" />
      <path d="M14 3l-2.5 8M18.5 4l-4.5 7" />
    </>
  ),
  explore: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
};

// The backend catalog uses "workshop" (singular); the rest match this screen's ids.
const INTEREST_TO_BACKEND: Record<InterestId, string> = {
  build: "build",
  coffee: "coffee",
  workshops: "workshop",
  gaming: "gaming",
  food: "food",
  explore: "explore",
};

type Step = "name" | "interests" | "questions";

function Segment({ active }: { active: boolean }) {
  return <span style={{ width: "24px", height: "4px", borderRadius: "2px", background: active ? "#315FE8" : "#D9C8BE" }} />;
}

export default function AboutYouScreen() {
  // Workflow A, first sign-in only: a display name (shown to your Rally, never the wallet), then exactly
  // three interests from a fixed catalog, then at most three 0G-chosen questions from fixed templates.
  // Matching is opt-in; nobody is added without accepting.
  const { api, setMe } = useSession();
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<InterestId[]>([]);

  // AI-composed questions for the chosen interests, fetched on entering step 3.
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qStatus, setQStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [qSource, setQSource] = useState<"ai" | "fallback" | null>(null);
  const [qError, setQError] = useState<string | null>(null);

  // Final submit (POST /onboarding/complete).
  const [optIn, setOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const full = picked.length >= 3;
  const onName = step === "name";
  const onInterests = step === "interests";
  const onQuestions = step === "questions";

  const togglePick = (id: InterestId) => {
    if (picked.includes(id)) setPicked(picked.filter((p) => p !== id));
    else if (!full) setPicked([...picked, id]);
    else return;
    // Interests changed → any loaded questions are now stale. Reset so step 3
    // refetches for the current picks (and drop answers tied to old questions).
    if (qStatus !== "idle") {
      setQStatus("idle");
      setQuestions([]);
      setQSource(null);
      setAnswers({});
    }
  };

  const setAnswer = (qid: string, v: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: v }));
  };

  const loadQuestions = useCallback(async () => {
    setQStatus("loading");
    setQError(null);
    try {
      const interests = picked.map((p) => INTEREST_TO_BACKEND[p]);
      const res = await api.getOnboardingQuestions(interests);
      setQuestions(res.questions);
      setQSource(res.source);
      setQStatus("ready");
    } catch (err) {
      setQError(errorMessage(err, "Could not load your questions."));
      setQStatus("error");
    }
  }, [api, picked]);

  const goToQuestions = () => {
    setStep("questions");
    if (qStatus === "idle" || qStatus === "error") loadQuestions();
  };

  const submitOnboarding = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: CompleteOnboardingInput = {
        interests: picked.map((p) => INTEREST_TO_BACKEND[p]),
        optInMatching: optIn,
        // Only non-empty answers, at most three, matched to their question id.
        answers: questions
          .map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? "").trim() }))
          .filter((a) => a.answer.length > 0)
          .slice(0, 3),
      };

      const trimmedName = name.trim();
      if (trimmedName) body.displayName = trimmedName;

      // Availability is required when opting into matching. "Find me a Rally now"
      // means available from now; default the window to the next 12 hours.
      if (optIn) {
        const now = new Date();
        body.availableFrom = now.toISOString();
        body.availableTo = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
      }

      // AppGate sees onboarded: true and moves on to the plan or to home.
      setMe(await api.completeOnboarding(body));
    } catch (err) {
      setSubmitError(errorMessage(err, "Could not save your profile."));
      setSubmitting(false);
    }
  }, [api, setMe, picked, optIn, questions, answers, name]);

  const footNote = onName
    ? "You can change this later"
    : onInterests
    ? `${picked.length} of 3 picked`
    : qStatus === "loading"
    ? "0G AI is choosing your questions…"
    : qStatus === "error"
    ? "Couldn't reach 0G AI"
    : qSource === "ai"
    ? "Questions chosen by 0G AI"
    : qSource === "fallback"
    ? "Using standard questions"
    : "A bit more about you";

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .ib { width: 44px; height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 1px solid #D9C8BE; border-radius: 50%; background: #FFFAF7; color: #1C1917; flex-shrink: 0; cursor: pointer; font-family: inherit; padding: 0; }
        .ib:hover { border-color: #1C1917; color: #1C1917; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .h1 { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 30px; line-height: 1.08; letter-spacing: -.01em; }
        .em { font-style: italic; color: #315FE8; }
        .card { background: #FFFAF7; border: 1px solid #D9C8BE; border-radius: 16px; }
        .tile { display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; gap: 10px; min-height: 100px; padding: 12px 14px 14px; border-radius: 16px; border: 1px solid #D9C8BE; background: #FFFAF7; font-family: inherit; text-align: left; color: #1C1917; cursor: pointer; box-sizing: border-box; transition: border-color .12s ease-out, background .12s ease-out, opacity .12s ease-out; }
        .tile:hover { border-color: #1C1917; }
        .tile:focus-visible, .chip:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .chip { display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid #D9C8BE; background: #FFFAF7; font-family: inherit; font-size: 14px; font-weight: 500; color: #1C1917; cursor: pointer; box-sizing: border-box; transition: border-color .12s ease-out, background .12s ease-out; }
        .chip:hover { border-color: #1C1917; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 56px; border: 0; border-radius: 999px; font-family: inherit; font-size: 16px; font-weight: 600; text-decoration: none; box-sizing: border-box; cursor: pointer; transition: transform .12s ease-out, background .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .btn-dis { background: #E8DFDA; color: #766B65; cursor: not-allowed; }
        .sw { appearance: none; -webkit-appearance: none; width: 52px; height: 32px; margin: 0; border-radius: 999px; background: #E8DFDA; position: relative; cursor: pointer; flex-shrink: 0; transition: background .15s ease-out; }
        .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%; background: #FFFAF7; transition: transform .15s ease-out; }
        .sw:checked { background: #1C1917; }
        .sw:checked::after { transform: translateX(20px); }
        .sw:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .field { width: 100%; height: 56px; padding: 0 18px; border-radius: 16px; border: 1px solid #1C1917; background: #FFFAF7; font-family: inherit; font-size: 18px; color: #1C1917; box-sizing: border-box; outline: none; }
        .field:focus { border: 1.5px solid #315FE8; }
        .field::placeholder { color: #766B65; }
        .qfield { width: 100%; height: 48px; padding: 0 16px; border-radius: 12px; border: 1px solid #D9C8BE; background: #FFFAF7; font-family: inherit; font-size: 15px; color: #1C1917; box-sizing: border-box; outline: none; transition: border-color .12s ease-out; }
        .qfield:focus { border: 1.5px solid #315FE8; }
        .qfield::placeholder { color: #766B65; }
        .spin { width: 28px; height: 28px; border-radius: 50%; border: 2.5px solid #E8DFDA; border-top-color: #315FE8; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }
        .foot { padding: 16px 24px 32px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; }
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
        <div className="bar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "64px", padding: "12px 24px 0", boxSizing: "border-box", flexShrink: 0 }}>
          {!onName ? (
            <button className="ib" type="button" aria-label="Back" onClick={() => setStep(onQuestions ? "interests" : "name")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5M11 6l-6 6 6 6" />
              </svg>
            </button>
          ) : (
            <span style={{ width: "44px" }} />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="mono" style={{ color: "#1C1917" }}>
              About you · {onName ? "1" : onInterests ? "2" : "3"} of 3
            </span>
            <span style={{ display: "flex", gap: "4px" }}>
              <Segment active />
              <Segment active={!onName} />
              <Segment active={onQuestions} />
            </span>
          </div>
          <span style={{ width: "44px" }} />
        </div>

        {onName && (
          <div style={{ flex: 1, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "24px", overflow: "hidden" }}>
            <div>
              <h1 className="h1">
                What should we <span className="em">call you?</span>
              </h1>
              <p style={{ margin: "8px 0 0", fontSize: "15px", lineHeight: 1.45, color: "#766B65" }}>
                Your first name or a nickname. People in your Rally see this, never your wallet. You can skip this.
              </p>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="mono">Your name · optional</span>
              <input
                className="field"
                type="text"
                autoComplete="given-name"
                placeholder="Divyanshi"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
        )}

        {onInterests && (
          <div style={{ flex: 1, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "20px", overflow: "hidden" }}>
            <div>
              <h1 className="h1">
                Pick your <span className="em">top three</span>
              </h1>
              <p style={{ margin: "8px 0 0", fontSize: "15px", lineHeight: 1.45, color: "#766B65" }}>
                Rally uses these to suggest plans and people. You can change them any time.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
              {CATALOG.map((t) => {
                const on = picked.includes(t.id);
                const dim = full && !on;
                return (
                  <button
                    key={t.id}
                    className="tile"
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePick(t.id)}
                    style={on ? { border: "1.5px solid #315FE8", background: "#E5ECFF" } : dim ? { opacity: 0.5 } : undefined}
                  >
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
                      <span aria-hidden="true" style={{ position: "relative", width: "32px", height: "32px", flexShrink: 0 }}>
                        <svg
                          width="28"
                          height="28"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#1C1917"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          style={{ position: "absolute", left: 0, top: 0 }}
                        >
                          {ICONS[t.id]}
                        </svg>
                      </span>
                      <span
                        style={{
                          width: "22px",
                          height: "22px",
                          borderRadius: "50%",
                          boxSizing: "border-box",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: on ? "#315FE8" : undefined,
                          border: on ? undefined : "1.5px solid #D9C8BE",
                        }}
                      >
                        {on && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFF5EF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "15px", fontWeight: 600 }}>{t.label}</span>
                      <span style={{ fontSize: "12px", color: "#766B65" }}>{t.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {onQuestions && (
          <div style={{ flex: 1, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto" }}>
            <div>
              <h1 className="h1">
                A bit <span className="em">more</span>
              </h1>
              <p style={{ margin: "8px 0 0", fontSize: "15px", lineHeight: 1.45, color: "#766B65" }}>
                {qStatus === "loading"
                  ? "0G is reading your interests to ask the right things. This takes a few seconds."
                  : "A few questions based on what you picked. Skip any you like."}
              </p>
            </div>

            {qStatus === "loading" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "40px 0" }}>
                <span className="spin" aria-hidden="true" />
                <span className="mono" role="status">Thinking about what to ask you…</span>
              </div>
            )}

            {qStatus === "error" && (
              <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <span style={{ fontSize: "15px", lineHeight: 1.45 }}>{qError}</span>
                <button className="chip" type="button" onClick={loadQuestions} style={{ alignSelf: "flex-start" }}>
                  Try again
                </button>
              </div>
            )}

            {qStatus === "ready" &&
              questions.map((q) => (
                <label key={q.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ fontSize: "16px", fontWeight: 600 }}>{q.text}</span>
                  <input
                    className="qfield"
                    type="text"
                    maxLength={300}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    placeholder="Your answer · optional"
                  />
                </label>
              ))}

            {qStatus === "ready" && (
              <label className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "16px", cursor: "pointer" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "15px", fontWeight: 600 }}>Find me a Rally now</span>
                  <span style={{ fontSize: "13px", lineHeight: 1.4, color: "#766B65" }}>
                    Rally checks live plans against your interests. Any fit goes to your inbox, and you still choose.
                  </span>
                </span>
                <input
                  className="sw"
                  type="checkbox"
                  role="switch"
                  checked={optIn}
                  onChange={(e) => setOptIn(e.target.checked)}
                />
              </label>
            )}
          </div>
        )}

        <div className="foot">
          {onName && (
            <button className="btn btn-p" type="button" onClick={() => setStep("interests")}>
              Continue
            </button>
          )}
          {onInterests && (
            <button
              className={full ? "btn btn-p" : "btn btn-dis"}
              type="button"
              aria-disabled={!full}
              onClick={() => {
                if (full) goToQuestions();
              }}
            >
              {full ? "Continue" : `Pick ${3 - picked.length} more`}
            </button>
          )}
          {onQuestions &&
            (qStatus === "ready" ? (
              <button
                className={submitting ? "btn btn-dis" : "btn btn-p"}
                type="button"
                onClick={submitOnboarding}
                disabled={submitting}
                aria-disabled={submitting}
              >
                {submitting ? "Saving…" : "Continue"}
                {!submitting && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                )}
              </button>
            ) : (
              <button className="btn btn-dis" type="button" aria-disabled="true" disabled>
                {qStatus === "loading" ? "Getting your questions…" : "Continue"}
              </button>
            ))}
          <div className="mono" style={{ textAlign: "center", color: submitError ? "#EC562E" : undefined }}>
            {submitError ?? footNote}
          </div>
        </div>
      </div>
    </div>
  );
}
