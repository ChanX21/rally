"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Inter, Instrument_Serif } from "next/font/google";
import { PreferenceEditor, PreferenceInput } from "@/components/PreferenceInput";
import RallyOrb from "@/components/RallyOrb";
import { errorMessage, type ParsedIntent } from "@/lib/api";
import { CATEGORIES, SENSITIVE_CATEGORIES, VIBES, ZONES, fromLocalInput, rallyPath } from "@/lib/format";
import { clearRallyCreation } from "@/lib/plan";
import { draftFromIntent, rallyDraftProblem, rallyInputFromDraft, type RallyDraft } from "@/lib/rally-draft";
import { useSession } from "@/lib/session";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"] });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal" });

const PLAN_SAMPLES = ["Coffee tomorrow at 5 PM", "Lunch with a few people"];

// Free-text field the user types themselves, with suggestions. What they type resolves to a
// known option id (case-insensitive) so publishing still validates; off-list text is kept as-is.
function TypeField({ options, value, onChange, placeholder, disabled }: {
  options: Array<{ value: string; label: string }>;
  value: string; onChange: (value: string) => void; placeholder: string; disabled?: boolean;
}) {
  const listId = useId();
  const current = options.find((option) => option.value === value);
  const display = current ? current.label : value;
  return <>
    <input list={listId} disabled={disabled} value={display} placeholder={placeholder} autoComplete="off"
      onChange={(event) => {
        const text = event.target.value;
        const match = options.find((option) => option.label.toLowerCase() === text.trim().toLowerCase());
        onChange(match ? match.value : text);
      }} />
    <datalist id={listId}>{options.map((option) => <option key={option.value} value={option.label} />)}</datalist>
  </>;
}

export default function CreateRallyScreen() {
  const { api } = useSession();
  const router = useRouter();
  const [stage, setStage] = useState<"plan" | "questions" | "review">("plan");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedIntent | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qIndex, setQIndex] = useState(0);
  const [maxQ, setMaxQ] = useState(0);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [maxReview, setMaxReview] = useState(0);
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const [draft, setDraft] = useState<RallyDraft | null>(null);
  const [busy, setBusy] = useState<"parse" | "answers" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submission = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => { clearRallyCreation(); }, []);

  // One question at a time: once the current one is answered (and typing pauses), it goes
  // and the next comes in. For option pickers we advance almost instantly.
  useEffect(() => {
    // Only advance from the frontier — if the user stepped back to edit, leave them there.
    if (stage !== "questions" || !parsed) return;
    const items = parsed.intent.questions;
    const current = items[qIndex];
    if (!current || qIndex !== maxQ || qIndex >= items.length - 1 || !(answers[current.id] ?? "").trim()) return;
    const timer = window.setTimeout(() => {
      const next = Math.min(items.length - 1, qIndex + 1);
      setNavDir(1); setQIndex(next); setMaxQ((max) => Math.max(max, next));
    }, current.options ? 200 : 750);
    return () => window.clearTimeout(timer);
  }, [answers, qIndex, maxQ, stage, parsed]);

  useEffect(() => { if (stage === "review") { setReviewIndex(0); setMaxReview(0); setNavDir(1); } }, [stage]);

  const accept = (result: ParsedIntent) => {
    setParsed(result);
    setDraft(draftFromIntent(result.intent));
    setQIndex(0); setMaxQ(0); setNavDir(1);
    setStage(result.status === "needs_answers" ? "questions" : "review");
  };
  const parse = async () => {
    if (!text.trim() || busy) return;
    setBusy("parse"); setError(null); setAnswers({});
    try { accept(await api.parseIntent(text.trim(), Intl.DateTimeFormat().resolvedOptions().timeZone)); }
    catch (err) { setError(errorMessage(err, "Could not read your plan.")); }
    finally { setBusy(null); }
  };
  const answer = async () => {
    if (!parsed || busy) return;
    const filled = parsed.intent.questions.map((question) => ({ questionId: question.id, answer: (answers[question.id] ?? "").trim() }))
      .filter((item) => item.answer);
    if (!filled.length) { setError(null); setStage("review"); return; }
    setBusy("answers"); setError(null);
    try { accept(await api.answerIntent(parsed.intent.id, filled)); }
    catch (err) { setError(errorMessage(err, "Could not read your answers. You can fill in the plan below.")); }
    finally { setBusy(null); }
  };
  const publish = async () => {
    if (!draft || !parsed || busy) return;
    setBusy("publish"); setError(null);
    try {
      const input = rallyInputFromDraft(draft, parsed.intent.id);
      const body = JSON.stringify(input);
      if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
      const rally = await api.createRally(input, submission.current.key);
      clearRallyCreation();
      router.replace(rallyPath(rally.status, rally.id));
    } catch (err) { setError(errorMessage(err, "Could not publish your Rally.")); }
    finally { setBusy(null); }
  };
  const set = (key: Exclude<keyof RallyDraft, "preferences">, value: string) =>
    setDraft((previous) => previous ? { ...previous, [key]: value, ...(key === "category" ? { preferences: {} } : {}) } : previous);
  const problem = draft ? rallyDraftProblem(draft) : null;
  const questions = parsed?.intent.questions ?? [];
  const currentQuestion = questions[qIndex];

  // Review fields reveal one after another, each once the previous one holds a valid value.
  const reviewSteps: Array<{ id: string; done: boolean; node: ReactNode }> = draft ? [
    { id: "goal", done: !!draft.goal.trim() && draft.goal.trim().length <= 160,
      node: <label key="goal" className="review-field">Rally title<input value={draft.goal} maxLength={160} disabled={!!busy} onChange={(event) => set("goal", event.target.value)} /></label> },
    { id: "category", done: CATEGORIES.some((category) => category.id === draft.category),
      node: <label key="category" className="review-field">Activity<TypeField options={CATEGORIES.map((category) => ({ value: category.id, label: category.label }))} value={draft.category} disabled={!!busy} placeholder="Type an activity…" onChange={(value) => set("category", value)} /></label> },
    { id: "start", done: (() => { const start = fromLocalInput(draft.start); return !!start && Date.parse(start) > Date.now(); })(),
      node: <label key="start" className="review-field">Start time<input type="datetime-local" value={draft.start} disabled={!!busy} onChange={(event) => set("start", event.target.value)} /></label> },
    { id: "duration", done: Number.isInteger(Number(draft.durationMin)) && Number(draft.durationMin) >= 5 && Number(draft.durationMin) <= 480,
      node: <label key="duration" className="review-field">Duration in minutes<input type="number" min={5} max={480} value={draft.durationMin} disabled={!!busy} onChange={(event) => set("durationMin", event.target.value)} /></label> },
    { id: "people", done: [Number(draft.groupMin), Number(draft.capacity)].every((size) => Number.isInteger(size) && size >= 2 && size <= 12) && Number(draft.groupMin) <= Number(draft.capacity),
      node: <div key="people" className="review-field">
        <div className="pair">
          <label>Minimum people<input type="number" min={2} max={12} value={draft.groupMin} disabled={!!busy} onChange={(event) => set("groupMin", event.target.value)} /></label>
          <label>Maximum people<input type="number" min={2} max={12} value={draft.capacity} disabled={!!busy} onChange={(event) => set("capacity", event.target.value)} /></label>
        </div>
        <p>Group sizes include you.</p>
      </div> },
    { id: "zone", done: ZONES.some((zone) => zone.id === draft.zone),
      node: <label key="zone" className="review-field">Meeting area<TypeField options={ZONES.map((zone) => ({ value: zone.id, label: zone.label }))} value={draft.zone} disabled={!!busy} placeholder="Type a meeting area…" onChange={(value) => set("zone", value)} /></label> },
    { id: "vibe", done: VIBES.some((vibe) => vibe.id === draft.vibe),
      node: <label key="vibe" className="review-field">Group atmosphere<TypeField options={VIBES.map((vibe) => ({ value: vibe.id, label: vibe.label }))} value={draft.vibe} disabled={!!busy} placeholder="Type a group atmosphere…" onChange={(value) => set("vibe", value)} /></label> },
    { id: "extras", done: true,
      node: <div key="extras" className="review-field">
        <PreferenceEditor categories={[draft.category]} preferences={draft.preferences} disabled={!!busy}
          onChange={(preferences) => setDraft((previous) => previous ? { ...previous, preferences } : previous)} />
        {SENSITIVE_CATEGORIES.includes(draft.category) && <p>This Rally stays private and will not appear on the public map.</p>}
      </div> },
  ] : [];
  const currentReview = reviewSteps[reviewIndex];

  // Stepping among already-seen questions/fields (never past the frontier the user has reached).
  const stepIndex = stage === "questions" ? qIndex : reviewIndex;
  const stepMax = stage === "questions" ? maxQ : maxReview;
  const stepGo = (dir: 1 | -1) => {
    setNavDir(dir);
    if (stage === "questions") setQIndex((index) => Math.max(0, Math.min(stepMax, index + dir)));
    else setReviewIndex((index) => Math.max(0, Math.min(stepMax, index + dir)));
  };

  useEffect(() => {
    // Only advance from the frontier — if the user stepped back to edit, leave them there.
    if (stage !== "review" || reviewIndex !== maxReview || reviewIndex >= reviewSteps.length - 1) return;
    if (!reviewSteps[reviewIndex]?.done) return;
    const timer = window.setTimeout(() => {
      const next = Math.min(reviewSteps.length - 1, reviewIndex + 1);
      setNavDir(1); setReviewIndex(next); setMaxReview((max) => Math.max(max, next));
    }, 700);
    return () => window.clearTimeout(timer);
    // reviewSteps is derived from draft; draft covers its changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, reviewIndex, maxReview, stage]);

  return <main className={`${inter.className} create-rally`}>
    <style>{`
      .create-rally { height:100dvh; background:#FFF5EF; color:#1C1917; display:flex; justify-content:center; }
      .create-rally .frame { width:100%; max-width:430px; height:100%; display:flex; flex-direction:column; }
      .create-rally .bar { padding:16px 24px; display:flex; justify-content:space-between; align-items:center; flex-shrink:0; }
      .create-rally .content { flex:1; min-height:0; overflow-y:auto; padding:12px 24px 24px; display:flex; flex-direction:column; gap:20px; }
      .create-rally h1 { margin:0; font-size:32px; font-weight:400; line-height:1.1; }
      .create-rally p { margin:0; color:#766B65; font-size:14px; line-height:1.5; }
      .create-rally label { display:flex; flex-direction:column; gap:8px; font-size:14px; font-weight:500; }
      .create-rally input,.create-rally textarea { width:100%; min-height:48px; box-sizing:border-box; padding:12px; border:1px solid #D9C8BE; border-radius:12px; background:#FFFAF7; color:inherit; font:inherit; }
      .create-rally input:focus-visible,.create-rally textarea:focus-visible { outline:2px solid #315FE8; outline-offset:2px; }
      .create-rally .fields { display:grid; gap:16px; }
      .create-rally .pair { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
      .create-rally .foot { display:grid; gap:10px; padding:16px 24px 28px; flex-shrink:0; }
      .create-rally .primary { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:52px; padding:12px 20px; border:0; border-radius:999px; background:#315FE8; color:white; font:inherit; font-weight:600; cursor:pointer; }
      .create-rally .primary:disabled { background:#E8DFDA; color:#766B65; cursor:not-allowed; }
      .create-rally .link { min-height:44px; padding:0; border:0; background:transparent; color:#315FE8; font:inherit; cursor:pointer; }
      .create-rally .link:disabled { color:#766B65; cursor:not-allowed; }
      .create-rally .error { color:#A33A1E; }
      .create-rally .orb-stage { flex:1; min-height:200px; display:flex; align-items:center; justify-content:center; margin:4px 0; }
      .create-rally .plan-field { gap:10px; }
      .create-rally .cap { font-size:12px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#766B65; }
      .create-rally .plan-group { display:flex; flex-direction:column; gap:10px; }
      .create-rally .samples { display:flex; flex-wrap:wrap; gap:8px; }
      .create-rally .sample { padding:6px 12px; border:1px solid #315FE8; border-radius:999px; background:transparent; color:#315FE8; font:inherit; font-size:13px; font-weight:500; line-height:1; cursor:pointer; transition:background .15s, color .15s; }
      .create-rally .sample:hover:not(:disabled) { background:#315FE8; color:#FFF5EF; }
      .create-rally .sample:disabled { opacity:.6; cursor:not-allowed; }
      .create-rally textarea.compact { min-height:auto; resize:none; padding:14px 16px; border:1px solid #E7D9CF; border-radius:14px; background:#FFFBF8; font-size:15px; line-height:1.5; box-shadow:0 1px 2px rgba(28,25,23,0.04); transition:border-color .15s, box-shadow .15s; }
      .create-rally textarea.compact::placeholder { color:#A89C94; }
      .create-rally textarea.compact:focus-visible { outline:none; border-color:#315FE8; box-shadow:0 0 0 3px rgba(49,95,232,0.14); }
      .create-rally .hint { font-size:13px; color:#99897F; }
      .create-rally .loading-row { display:flex; align-items:center; gap:10px; }
      .create-rally .attrib { font-size:11px; color:#A89C94; letter-spacing:0.02em; word-break:break-all; }
      .create-rally .step { font-size:12px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#99897F; margin-bottom:12px; }
      .create-rally .step-item { display:flex; flex-direction:column; gap:16px; animation:step-in .32s cubic-bezier(.22,.61,.36,1) both; }
      .create-rally .step-item.in-left { animation-name:step-in-left; }
      @keyframes step-in { from { opacity:0; transform:translateX(26px); } to { opacity:1; transform:none; } }
      @keyframes step-in-left { from { opacity:0; transform:translateX(-26px); } to { opacity:1; transform:none; } }
      @media (prefers-reduced-motion: reduce) { .create-rally .step-item { animation:none; } }
      .create-rally .stepnav { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
      .create-rally .back { display:inline-flex; align-items:center; gap:4px; min-height:36px; padding:4px 10px 4px 4px; border:0; border-radius:999px; background:transparent; color:#315FE8; font:inherit; font-size:14px; font-weight:500; cursor:pointer; }
      .create-rally .back.next { padding:4px 4px 4px 10px; }
      .create-rally .back:hover:not(:disabled) { background:rgba(49,95,232,0.08); }
      .create-rally .back:disabled { color:#766B65; cursor:not-allowed; }
    `}</style>
    <div className="frame">
      <nav className="bar" aria-label="Rally creation">
        <button className="link" disabled={busy === "publish"} onClick={() => { clearRallyCreation(); router.replace("/app/home"); }}>Cancel</button>
        <span style={{ fontSize:12, color:"#766B65" }}>Your own Rally</span>
      </nav>
      <div className="content">
        {(stage === "questions" || stage === "review") && (stepIndex > 0 || stepIndex < stepMax) && (
          <div className="stepnav">
            {stepIndex > 0 ? (
              <button type="button" className="back" disabled={!!busy} onClick={() => stepGo(-1)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5M11 18l-6-6 6-6" />
                </svg>
                Back
              </button>
            ) : <span />}
            {stepIndex < stepMax && (
              <button type="button" className="back next" disabled={!!busy} onClick={() => stepGo(1)}>
                Next
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            )}
          </div>
        )}
        <h1 className={serif.className}>{stage === "plan" ? "What are we rallying for?" : stage === "questions" ? "A few details" : "Review your Rally"}</h1>
        {stage === "plan" && <>
          <p>Describe what you want to do. Rally will use your profile and ask up to three questions about this activity.</p>
          <div className="orb-stage" aria-hidden="true"><RallyOrb variant="active" size={220} /></div>
        </>}
        {stage === "questions" && currentQuestion && <>
          <p>{text}</p>
          <div key={qIndex} className={`step-item ${navDir === 1 ? "in-right" : "in-left"}`}>
            <p className="step">Question {qIndex + 1} of {questions.length}</p>
            <label className="question">
              <span>{currentQuestion.text}</span>
              {currentQuestion.options ? <PreferenceInput disabled={!!busy} options={currentQuestion.options} value={answers[currentQuestion.id] ?? ""}
                onChange={(value) => setAnswers((previous) => ({ ...previous, [currentQuestion.id]: value }))} />
                : <input disabled={!!busy} maxLength={300} value={answers[currentQuestion.id] ?? ""} placeholder="Your answer"
                  onChange={(event) => setAnswers((previous) => ({ ...previous, [currentQuestion.id]: event.target.value }))} />}
            </label>
          </div>
        </>}
        {stage === "review" && draft && currentReview && <>
          <p>{parsed?.status === "needs_review" ? "Rally could not confirm every detail. Check and edit the plan before publishing." : "Check the details before we look for people to invite."}</p>
          <div className="fields">
            <div key={reviewIndex} className={`step-item ${navDir === 1 ? "in-right" : "in-left"}`}>
              <p className="step">Step {reviewIndex + 1} of {reviewSteps.length}</p>
              {currentReview.node}
            </div>
          </div>
        </>}
        {busy && <p role="status" className="loading-row"><RallyOrb variant="searching" size={22} /><span>{busy === "publish" ? "Publishing your Rally…" : "Rally intelligence is reading your plan…"}</span></p>}
        {error && <p className="error" role="alert">{error}</p>}
        {stage !== "plan" && parsed?.intent.source === "ai" && parsed.aiRequestId && (
          <p className="attrib">request id: {parsed.aiRequestId} · by 0G</p>
        )}
      </div>
      <div className="foot">
        {stage === "plan" && <>
          <div className="plan-group">
            <span className="cap">What are you upto?</span>
            <div className="samples">
              {PLAN_SAMPLES.map((sample) => (
                <button key={sample} type="button" className="sample" disabled={!!busy} onClick={() => setText(sample)}>{sample}</button>
              ))}
            </div>
            <textarea className="compact" rows={2} maxLength={500} aria-label="What are you upto?" disabled={!!busy} value={text} onChange={(event) => setText(event.target.value)} placeholder="Coffee tomorrow at 5 PM for half an hour?" />
          </div>
          <p className="hint">You will be the host. The default group is you and one guest.</p>
          <button className="primary" disabled={!!busy || !text.trim()} onClick={() => void parse()}>
            Continue
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </>}
        {stage === "questions" && (
          <button className="primary" disabled={!!busy} onClick={() => void answer()}>Review plan</button>
        )}
        {stage === "review" && <>
          {problem && <p role="status">{problem}</p>}
          <button className="primary" disabled={!!busy || !!problem} onClick={() => void publish()}>Publish Rally</button>
          <button className="link" disabled={!!busy} onClick={() => { setError(null); setStage("plan"); }}>Change activity</button>
        </>}
      </div>
    </div>
  </main>;
}
