"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { errorCode, errorMessage, type Intent, type ParsedIntent } from "@/lib/api";
import { CATEGORIES, SENSITIVE_CATEGORIES, VIBES, ZONES, displayTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { clearPlan, readPlan, saveParsed } from "@/lib/plan";
import { PreferenceInput, PreferenceEditor } from "@/components/PreferenceInput";
import { useSession } from "@/lib/session";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

type Form = {
  preferences: Record<string, string>;
  category: string;
  goal: string;
  start: string;
  end: string;
  durationMin: string;
  zone: string;
  groupMin: string;
  capacity: string;
  vibe: string;
};

// Any field can be null, and the form must let the user fill it.
function formFrom(intent: Intent): Form {
  return {
    preferences: intent.preferences ?? {},
    category: intent.category ?? "",
    goal: intent.goal ?? "",
    start: toLocalInput(intent.windowStart),
    end: toLocalInput(intent.windowEnd),
    durationMin: intent.durationMin?.toString() ?? "",
    zone: intent.zone ?? "",
    groupMin: intent.groupMin?.toString() ?? "",
    capacity: intent.groupMax?.toString() ?? "",
    vibe: intent.vibe ?? "any",
  };
}

// Returns what is still missing or wrong, so the button can explain itself.
function formProblem(form: Form): string | null {
  if (!form.category) return "Pick an activity";
  if (!form.goal.trim()) return "Say what the plan is";
  const start = fromLocalInput(form.start);
  const end = fromLocalInput(form.end);
  if (!start) return "Pick a start time";
  if (!end) return "Pick when to stop looking";
  const duration = Number(form.durationMin);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) return "Duration is 5 to 480 minutes";
  // windowEnd is when the rally expires, and must leave room for the whole plan.
  if (new Date(end).getTime() - new Date(start).getTime() < duration * 60_000) {
    return "Keep looking until at least the end of the plan";
  }
  if (!form.zone) return "Pick an area";
  const groupMin = Number(form.groupMin);
  const capacity = Number(form.capacity);
  if (!Number.isInteger(groupMin) || groupMin < 2 || groupMin > 12) return "Minimum group is 2 to 12, including you";
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 12) return "Maximum group is 2 to 12, including you";
  if (groupMin > capacity) return "The minimum can't be above the maximum";
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="fld">
      <span style={{ width: "88px", flexShrink: 0, fontSize: "13px", color: "#766B65" }}>{label}</span>
      {children}
    </label>
  );
}

export default function CheckPlanScreen() {
  // Workflow B: 0G asks at most three questions, only ones that change matching. Nothing is
  // published until the user confirms this form. Sensitive plans are always private.
  const { api } = useSession();
  const router = useRouter();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedIntent | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [onBoard, setOnBoard] = useState(false);
  const [busy, setBusy] = useState<"parse" | "answers" | "publish" | "activate" | null>("parse");
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback((result: ParsedIntent) => {
    saveParsed(result);
    setParsed(result);
    setForm(formFrom(result.intent));
    setShowForm(result.status !== "needs_answers");
  }, []);

  // Each parse spends AI budget and creates an intent, so React's double effect
  // run must not send it twice.
  const parseStarted = useRef(false);
  const runParse = useCallback(
    async (planText: string) => {
      setBusy("parse");
      setError(null);
      try {
        accept(await api.parseIntent(planText, Intl.DateTimeFormat().resolvedOptions().timeZone));
      } catch (err) {
        setError(errorMessage(err, "Could not read your plan."));
      } finally {
        setBusy(null);
      }
    },
    [api, accept]
  );

  useEffect(() => {
    if (parseStarted.current) return;
    parseStarted.current = true;
    const plan = readPlan();
    if (!plan) {
      router.replace("/app/home");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists on the client
    setText(plan.text);
    if (plan.parsed) {
      accept(plan.parsed);
      setBusy(null);
    } else {
      void runParse(plan.text);
    }
  }, [router, accept, runParse]);

  const submitAnswers = async () => {
    if (!parsed) return;
    const filled = parsed.intent.questions
      .map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? "").trim() }))
      .filter((a) => a.answer.length > 0);
    if (filled.length === 0) {
      setShowForm(true);
      return;
    }
    setBusy("answers");
    setError(null);
    try {
      accept(await api.answerIntent(parsed.intent.id, filled));
    } catch (err) {
      // Allowed once per intent. Whatever went wrong, the form still works.
      if (errorCode(err) !== "PARSE_BUDGET_EXHAUSTED") setError(errorMessage(err));
      setShowForm(true);
    } finally {
      setBusy(null);
    }
  };

  const problem = form ? formProblem(form) : "Loading";
  const sensitive = form ? SENSITIVE_CATEGORIES.includes(form.category) : false;

  const publish = async () => {
    const plan = readPlan();
    if (!form || !parsed || problem) return;
    setBusy("publish");
    setError(null);
    try {
      const rally = await api.createRally(
        {
          intentId: parsed.intent.id,
          preferences: form.preferences,
          category: form.category,
          goal: form.goal.trim(),
          vibe: form.vibe || undefined,
          windowStart: fromLocalInput(form.start)!,
          windowEnd: fromLocalInput(form.end)!,
          durationMin: Number(form.durationMin),
          zone: form.zone,
          groupMin: Number(form.groupMin),
          capacity: Number(form.capacity),
          visibility: onBoard && !sensitive ? "public_coarse" : "private",
          publish: true,
        },
        plan?.idempotencyKey ?? parsed.intent.id
      );
      clearPlan();
      router.replace(`/app/finding-people?rally=${rally.id}`);
    } catch (err) {
      setError(errorMessage(err, "Could not publish your plan."));
      setBusy(null);
    }
  };

  // The other way out: don't host anything, just wait for a plan that fits.
  const keepInterest = async () => {
    if (!form || !parsed || problem) return;
    setBusy("activate");
    setError(null);
    try {
      const windowEnd = fromLocalInput(form.end)!;
      await api.activateIntent(parsed.intent.id, {
        preferences: form.preferences,
        category: form.category,
        windowStart: fromLocalInput(form.start)!,
        windowEnd,
        durationMin: Number(form.durationMin),
        zone: form.zone,
        vibe: form.vibe || undefined,
        expiresAt: windowEnd,
      });
      clearPlan();
      router.replace(`/app/no-fit?intent=${parsed.intent.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const goBack = () => {
    // Drop the draft so it doesn't linger. Failure here changes nothing for the user.
    if (parsed) void api.cancelIntent(parsed.intent.id).catch(() => {});
    clearPlan();
    router.replace("/app/home");
  };

  const set = (key: Exclude<keyof Form, "preferences">, value: string) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const parsing = busy === "parse";
  const asking = !parsing && parsed !== null && !showForm;
  const reviewing = !parsing && parsed !== null && showForm && form !== null;
  const zoneOptions = form?.zone && !ZONES.some((z) => z.id === form.zone) ? [...ZONES, { id: form.zone, label: form.zone }] : ZONES;
  const endLabel = form?.end ? displayTime(new Date(form.end).toISOString()) : "the end time";

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .ib { width: 44px; height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; padding: 0; border: 1px solid #D9C8BE; border-radius: 50%; background: #FFFAF7; color: #1C1917; position: relative; flex-shrink: 0; cursor: pointer; }
        .ib:hover { border-color: #1C1917; color: #1C1917; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .h1 { margin: 0; font-family: ${SERIF}; font-weight: 400; font-size: 30px; line-height: 1.08; letter-spacing: -.01em; }
        .em { font-style: italic; color: #315FE8; }
        .card { background: #FFFAF7; border: 1px solid #D9C8BE; border-radius: 16px; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 56px; border: 0; border-radius: 999px; font-family: inherit; font-size: 16px; font-weight: 600; text-decoration: none; box-sizing: border-box; cursor: pointer; transition: transform .12s ease-out, background .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn-p { background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .btn:disabled { background: #E8DFDA; color: #766B65; cursor: not-allowed; }
        .lnk { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; padding: 0; border: 0; background: transparent; font-family: inherit; font-size: 15px; font-weight: 500; color: #1C1917; cursor: pointer; }
        .lnk:disabled { color: #766B65; cursor: not-allowed; }
        .foot { padding: 12px 24px 24px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
        .fld { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 0 16px; border-top: 1px solid #D9C8BE; color: #1C1917; box-sizing: border-box; }
        .fld:first-child { border-top: 0; }
        .fld input, .fld select { flex: 1; min-width: 0; height: 42px; border: 0; outline: none; background: transparent; font-family: inherit; font-size: 15px; font-weight: 500; color: #1C1917; }
        .fld:focus-within { background: #E5ECFF; }
        .qfield { width: 100%; height: 48px; padding: 0 16px; border-radius: 12px; border: 1px solid #D9C8BE; background: #FFFAF7; font-family: inherit; font-size: 15px; color: #1C1917; box-sizing: border-box; outline: none; }
        .qfield:focus { border: 1.5px solid #315FE8; }
        .cb { position: relative; width: 22px; height: 22px; flex-shrink: 0; }
        .cb input { appearance: none; -webkit-appearance: none; width: 22px; height: 22px; margin: 0; border-radius: 6px; border: 1.5px solid #766B65; background: #FFFAF7; cursor: pointer; }
        .cb input:checked { background: #1C1917; border-color: #1C1917; }
        .cb svg { position: absolute; left: 4px; top: 4px; opacity: 0; pointer-events: none; }
        .cb input:checked + svg { opacity: 1; }
        .cb input:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .spin { width: 28px; height: 28px; border-radius: 50%; border: 2.5px solid #E8DFDA; border-top-color: #315FE8; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }
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
          <button className="ib" type="button" onClick={goBack} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </button>
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

        <div style={{ flex: 1, minHeight: 0, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto" }}>
          <h1 className="h1">
            {reviewing ? "Check" : asking ? "A few quick" : "Reading"} <span className="em">{reviewing ? "your plan" : asking ? "questions" : "your plan"}</span>
          </h1>

          {text && (
            <div style={{ alignSelf: "flex-end", maxWidth: "84%", padding: "12px 16px", borderRadius: "16px 16px 4px 16px", background: "#1C1917", color: "#FFF5EF", fontSize: "15px", lineHeight: 1.45 }}>
              {text}
            </div>
          )}

          {parsing && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "32px 0" }}>
              <span className="spin" aria-hidden="true" />
              <span className="mono" role="status" style={{ textAlign: "center" }}>
                0G is reading your plan. This can take up to half a minute.
              </span>
            </div>
          )}

          {!parsing && !parsed && error && (
            <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <span role="alert" style={{ fontSize: "15px", lineHeight: 1.45 }}>{error}</span>
              <button className="lnk" type="button" onClick={() => void runParse(text)} style={{ justifyContent: "flex-start" }}>
                Try again
              </button>
            </div>
          )}

          {asking && parsed && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {parsed.intent.questions.map((q) => (
                <label key={q.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ fontSize: "16px", fontWeight: 600 }}>{q.text}</span>
                  {q.options ? (
                    <PreferenceInput className="qfield" value={answers[q.id] ?? ""} options={q.options} onChange={(value) => setAnswers({ ...answers, [q.id]: value })} />
                  ) : (
                  <input
                    className="qfield"
                    type="text"
                    maxLength={300}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    placeholder="Your answer"
                  />
                  )}
                </label>
              ))}
              <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.45, color: "#766B65" }}>
                0G only asks what changes who you&apos;re matched with. Never more than three.
              </p>
            </div>
          )}

          {reviewing && form && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="mono">{parsed.status === "needs_review" ? "Please fill this in" : "Rally understood"}</span>
                <span className="mono" style={{ color: "#315FE8" }}>
                  Tap to edit
                </span>
              </div>
              <div className="card" style={{ marginTop: "8px", overflow: "hidden" }}>
                <Field label="Activity">
                  <select value={form.category} onChange={(e) => set("category", e.target.value)}>
                    <option value="">Choose…</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Plan">
                  <input type="text" maxLength={160} value={form.goal} onChange={(e) => set("goal", e.target.value)} />
                </Field>
                <Field label="Starts">
                  <input type="datetime-local" value={form.start} onChange={(e) => set("start", e.target.value)} />
                </Field>
                <Field label="How long">
                  <input type="number" inputMode="numeric" min={5} max={480} placeholder="Minutes" value={form.durationMin} onChange={(e) => set("durationMin", e.target.value)} />
                </Field>
                <Field label="Look until">
                  <input type="datetime-local" value={form.end} onChange={(e) => set("end", e.target.value)} />
                </Field>
                <Field label="Min group">
                  <input type="number" inputMode="numeric" min={2} max={12} placeholder="Including you" value={form.groupMin} onChange={(e) => set("groupMin", e.target.value)} />
                </Field>
                <Field label="Max group">
                  <input type="number" inputMode="numeric" min={2} max={12} placeholder="Including you" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
                </Field>
                <Field label="Where">
                  <select value={form.zone} onChange={(e) => set("zone", e.target.value)}>
                    <option value="">Choose…</option>
                    {zoneOptions.map((z) => (
                      <option key={z.id} value={z.id}>{z.label}</option>
                    ))}
                  </select>
                </Field>
                <div style={{ gridColumn: "1 / -1" }}>
                  <PreferenceEditor preferences={form.preferences} categories={[form.category]}
                    onChange={(preferences) => setForm((previous) => previous ? { ...previous, preferences } : previous)} />
                </div>
                <Field label="Vibe">
                  <select value={form.vibe} onChange={(e) => set("vibe", e.target.value)}>
                    {VIBES.map((v) => (
                      <option key={v.id} value={v.id}>{v.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          )}
        </div>

        <div className="foot">
          {asking && (
            <button className="btn btn-p" type="button" onClick={() => void submitAnswers()} disabled={busy === "answers"}>
              {busy === "answers" ? "0G is updating your plan…" : "Continue"}
            </button>
          )}
          {reviewing && (
            <>
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
                    <input type="checkbox" checked={onBoard} onChange={(e) => setOnBoard(e.target.checked)} />
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFF5EF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600 }}>Show this plan on the live board</span>
                    <span style={{ fontSize: "13px", lineHeight: 1.4, color: "#766B65" }}>Only activity, area and time. No name or wallet.</span>
                  </span>
                </label>
              )}
              <button className="btn btn-p" type="button" onClick={() => void publish()} disabled={busy !== null || problem !== null}>
                {busy === "publish" ? "Publishing…" : problem ?? "Confirm and find company"}
              </button>
              <button className="lnk" type="button" onClick={() => void keepInterest()} disabled={busy !== null || problem !== null}>
                {busy === "activate" ? "Saving…" : `Just keep this interest active until ${endLabel}`}
              </button>
            </>
          )}
          <div className="mono" role={parsed && error ? "alert" : undefined} style={{ textAlign: "center", color: parsed && error ? "#EC562E" : undefined }}>
            {parsed && error
              ? error
              : parsed?.aiRequestId
              ? `Read by 0G AI · req ${parsed.aiRequestId.slice(0, 12)}`
              : parsed
              ? "0G AI wasn't available. Please check the details"
              : "Read by 0G AI"}
          </div>
        </div>
      </div>
    </div>
  );
}
