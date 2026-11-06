"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { errorMessage, type CompleteOnboardingInput, type OnboardingQuestion } from "@/lib/api";
import { PreferenceInput } from "@/components/PreferenceInput";
import { Dropdown } from "@/components/Dropdown";
import { useSession } from "@/lib/session";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

type InterestId =
  | "build" | "coffee" | "workshops" | "gaming" | "food" | "explore"
  | "music" | "photography" | "arts" | "football" | "gym" | "nature"
  | "fashion" | "travel" | "finance" | "technology" | "books" | "animals";

// The first six are wired to the backend catalog; the rest are display-only for
// now and will be wired to backend categories (and their questions) later.
const CATALOG: Array<{ id: InterestId; label: string }> = [
  { id: "build", label: "Build" },
  { id: "coffee", label: "Coffee" },
  { id: "workshops", label: "Workshop" },
  { id: "gaming", label: "Gaming" },
  { id: "food", label: "Food" },
  { id: "explore", label: "Explore" },
  { id: "music", label: "Music" },
  { id: "photography", label: "Photography" },
  { id: "arts", label: "Arts" },
  { id: "football", label: "Football" },
  { id: "gym", label: "Gym" },
  { id: "nature", label: "Nature" },
  { id: "fashion", label: "Fashion" },
  { id: "travel", label: "Travel" },
  { id: "finance", label: "Finance" },
  { id: "technology", label: "Technology" },
  { id: "books", label: "Books" },
  { id: "animals", label: "Animals" },
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
  music: (
    <>
      <path d="M9 17V5l10-2v12" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </>
  ),
  photography: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7l1.5-2.5h5L16 7" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  arts: (
    <>
      <path d="M12 3a9 9 0 1 0 1 18c1 0 1.5-.8 1.5-1.8 0-1.3.9-1.7 1.7-1.7H18a3 3 0 0 0 3-3c0-5-4-8.5-9-8.5z" />
      <circle cx="8.5" cy="11" r="1" />
      <circle cx="12" cy="8.5" r="1" />
      <circle cx="15.5" cy="11" r="1" />
    </>
  ),
  football: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5l4.3 3.1-1.6 5h-5.4l-1.6-5z" />
    </>
  ),
  gym: <path d="M6.5 7v10M3.5 9v6M17.5 7v10M20.5 9v6M6.5 12h11" />,
  nature: (
    <>
      <path d="M4 20c0-9 7-15 16-15 0 9-7 15-16 15z" />
      <path d="M4 20c3-4 7-7 12-9" />
    </>
  ),
  fashion: <path d="M8 3.5l4 2 4-2 4.5 4-3 2.5V20H6.5V10L3.5 7.5z" />,
  travel: (
    <>
      <path d="M21 3L3 10.5l6.5 2.5L12 20l3-6z" />
      <path d="M9.5 13L21 3" />
    </>
  ),
  finance: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.3c-.5-1-1.5-1.5-2.7-1.5-1.6 0-2.8.9-2.8 2.1 0 1.1 1 1.7 2.8 2.1 1.8.4 2.8 1 2.8 2.1 0 1.2-1.2 2.1-2.8 2.1-1.3 0-2.3-.6-2.8-1.6M12 6v12" />
    </>
  ),
  technology: <path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 1 3.8 10.6c-.5.5-.8 1-.8 1.9H9c0-.9-.3-1.4-.8-1.9A6 6 0 0 1 12 3z" />,
  books: (
    <>
      <path d="M4 5.5A2 2 0 0 1 6 4h13v15H6a2 2 0 0 0-2 2z" />
      <path d="M19 19H6" />
    </>
  ),
  animals: (
    <>
      <circle cx="7" cy="11" r="1.6" />
      <circle cx="12" cy="8.5" r="1.6" />
      <circle cx="17" cy="11" r="1.6" />
      <path d="M12 13c-2.5 0-4.5 1.8-4.5 3.8 0 1.2 1 1.9 2.2 1.9.9 0 1.5-.4 2.3-.4s1.4.4 2.3.4c1.2 0 2.2-.7 2.2-1.9 0-2-2-3.8-4.5-3.8z" />
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
  // Placeholder mappings — these are not real backend categories yet.
  music: "music",
  photography: "photography",
  arts: "arts",
  football: "football",
  gym: "gym",
  nature: "nature",
  fashion: "fashion",
  travel: "travel",
  finance: "finance",
  technology: "technology",
  books: "books",
  animals: "animals",
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
  // "Create your own rally" deep-links straight to the interests step (skipping name).
  const startAtInterests = useSearchParams().get("start") === "interests";
  const [step, setStep] = useState<Step>(startAtInterests ? "interests" : "name");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<InterestId[]>([]);

  // AI-composed questions for the chosen interests, fetched on entering step 3.
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qStatus, setQStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [qSource, setQSource] = useState<"ai" | "fallback" | null>(null);
  const [qError, setQError] = useState<string | null>(null);

  // Final submit (POST /onboarding/complete).
  const [optIn, setOptIn] = useState(true);
  const [availableHours, setAvailableHours] = useState(12);
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

      // Availability is required when opting into matching. "Receive Rally invites"
      // means available from now; default the window to the next 12 hours.
      if (optIn) {
        const now = new Date();
        body.availableFrom = now.toISOString();
        body.availableTo = new Date(now.getTime() + availableHours * 60 * 60 * 1000).toISOString();
      }

      // AppGate sees onboarded: true and moves on to the plan or to home.
      setMe(await api.completeOnboarding(body));
    } catch (err) {
      setSubmitError(errorMessage(err, "Could not save your profile."));
      setSubmitting(false);
    }
  }, [api, setMe, picked, optIn, questions, answers, name, availableHours]);

  const footNote = onName
    ? "You can change this later"
    : onInterests
    ? `${picked.length} of 3 picked`
    : qStatus === "loading"
    ? "Rally intelligence is choosing your questions…"
    : qStatus === "error"
    ? "Couldn't reach Rally intelligence"
    : qSource === "ai"
    ? "Questions chosen by Rally intelligence"
    : qSource === "fallback"
    ? "Using standard questions"
    : "A bit more about you";

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", height: "100dvh", display: "flex", justifyContent: "center", padding: "0" }}
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
        .chip { display: inline-flex; align-items: center; gap: 9px; padding: 12px 18px; border-radius: 999px; border: 0; background: #EFE7E1; color: #1C1917; font-family: inherit; font-size: 15px; font-weight: 600; cursor: pointer; box-sizing: border-box; transition: background .14s ease-out, color .14s ease-out, transform .1s ease-out, opacity .14s ease-out; }
        .chip:hover { background: #E7DDD6; }
        .chip:active { transform: scale(.96); }
        .chip[aria-pressed="true"] { background: #315FE8; color: #FFF5EF; }
        .chip[aria-pressed="true"]:hover { background: #2A52CC; }
        .chip:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .appear { animation: appearUp .4s cubic-bezier(.22,1,.36,1) both; }
        @keyframes appearUp { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { .appear { animation: none; } }
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
          width: "100%", maxWidth: "430px",
          height: "100%",
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center", overflowY: "auto", alignContent: "flex-start" }}>
              {CATALOG.map((t, i) => {
                const on = picked.includes(t.id);
                const dim = full && !on;
                return (
                  <button
                    key={t.id}
                    className="chip appear"
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePick(t.id)}
                    style={{ animationDelay: `${i * 40}ms`, ...(dim ? { opacity: 0.45 } : {}) }}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {ICONS[t.id]}
                    </svg>
                    {t.label}
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
                  ? "Rally intelligence is reading your interests to ask the right things. This takes a few seconds."
                  : "A few questions based on what you picked. Skip any you like."}
              </p>
              <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.4, color: "#766B65" }}>
                Your Rally points and reliability history are recorded publicly on Arc against your wallet address.
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
              questions.map((q, i) => (
                <label key={q.id} className="appear" style={{ animationDelay: `${i * 110}ms`, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ fontSize: "16px", fontWeight: 600 }}>{q.text}</span>
                  {q.options ? (
                    <PreferenceInput className="qfield" value={answers[q.id] ?? ""} options={q.options} onChange={(value) => setAnswer(q.id, value)} />
                  ) : (
                  <input
                    className="qfield"
                    type="text"
                    maxLength={300}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    placeholder="Your answer · optional"
                  />
                  )}
                </label>
              ))}

            {qStatus === "ready" && optIn && (
              <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span>Available for the next</span>
                <Dropdown
                  ariaLabel="Available for the next"
                  value={String(availableHours)}
                  options={[1, 2, 4, 8, 12, 24].map((hours) => ({ value: String(hours), label: `${hours} hours` }))}
                  onChange={(v) => setAvailableHours(Number(v))}
                />
                <span style={{ fontSize: 13, color: "#766B65" }}>Change or pause this anytime in Profile.</span>
              </label>
            )}
            {qStatus === "ready" && (
              <label className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "16px", cursor: "pointer" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "15px", fontWeight: 600 }}>Receive Rally invites</span>
                  <span style={{ fontSize: "13px", lineHeight: 1.4, color: "#766B65" }}>
                    Get invites for compatible plans during your availability, even when you leave the app. You choose whether to join.
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
