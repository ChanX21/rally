"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Inter, Instrument_Serif } from "next/font/google";
import RallyLoader from "@/components/RallyLoader";
import RallyOrb from "@/components/RallyOrb";
import { PreferenceEditor, PreferenceInput } from "@/components/PreferenceInput";
import { errorMessage, type ParsedIntent } from "@/lib/api";
import { CATEGORIES, SENSITIVE_CATEGORIES, VIBES, ZONES, categoryLabel, zoneLabel, preferenceText, fromLocalInput, rallyPath } from "@/lib/format";
import { AiRequests } from "@/components/AiRequests";
import type { AiRequest } from "@/lib/api";
import { clearRallyCreation } from "@/lib/plan";
import { TYPED_AREA_ZONE, draftFromIntent, isFixedArea, rallyDraftIssues, rallyDraftProblem, rallyInputFromDraft, type RallyDraft, type RallyDetail } from "@/lib/rally-draft";
import { useSession } from "@/lib/session";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"] });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal" });

const PLAN_SAMPLES = ["Coffee tomorrow at 5 PM", "Lunch with a few people"];

// The backend only accepts these exact activity and atmosphere options, so free text could never be saved.
function SelectField({ options, value, onChange, disabled }: {
  options: Array<{ value: string; label: string }>;
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const known = options.some((option) => option.value === value);
  return <select disabled={disabled} value={known ? value : ""} onChange={(event) => onChange(event.target.value)}>
    {!known && <option value="" disabled>Choose one</option>}
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}

function AreaInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <input disabled={disabled} maxLength={120} autoComplete="off" placeholder="Type a place, like Pavilion 2" value={zoneLabel(value)}
    onChange={(event) => {
      const text = event.target.value;
      const fixed = ZONES.find((zone) => zone.label.toLowerCase() === text.trim().toLowerCase());
      onChange(fixed ? fixed.id : text);
    }} />;
}

function AreaOptions({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <>
    <div className="samples" role="group" aria-label="Suggested areas">
      {ZONES.map((zone) => <button key={zone.id} type="button" className="sample area-option" aria-pressed={value === zone.id} disabled={disabled} onClick={() => onChange(zone.id)}>{zone.label}</button>)}
    </div>
    {value.trim() && !isFixedArea(value) && <p className="field-hint">Only your group sees this place. Invites say &ldquo;{zoneLabel(TYPED_AREA_ZONE)}&rdquo; until then.</p>}
  </>;
}

export default function CreateRallyScreen() {
  const { api } = useSession();
  const router = useRouter();
  const [stage, setStage] = useState<"plan" | "questions" | "details" | "review" | "edit">("plan");
  const [detailFields, setDetailFields] = useState<RallyDetail[]>([]);
  const [text, setText] = useState("");
  const [receipts, setReceipts] = useState<AiRequest[]>([]);
  const [parsed, setParsed] = useState<ParsedIntent | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [draft, setDraft] = useState<RallyDraft | null>(null);
  const [busy, setBusy] = useState<"parse" | "answers" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => { clearRallyCreation(); }, []);

  const review = (next: RallyDraft) => {
    const missing = Object.keys(rallyDraftIssues(next)) as RallyDetail[];
    setDetailFields(missing.slice(0, 3));
    setError(null);
    setBlocked(false);
    setStage(missing.length ? "details" : "review");
  };
  const accept = (result: ParsedIntent, currentAnswers: Record<string, string> = {}) => {
    const next = draftFromIntent(result.intent, currentAnswers);
    if (result.aiRequestId) setReceipts((previous) => [...previous, { task: "intent", requestId: result.aiRequestId!, outcome: result.status === "needs_review" ? "fallback" : "ok" }]);
    setParsed(result);
    setQuestionIndex(0);
    setDraft(next);
    if (result.status === "needs_answers") setStage("questions");
    else review(next);
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
    const filled = parsed.intent.questions.map((question) => {
      const value = (answers[question.id] ?? "").trim();
      // The AI only gets the coarse area. The typed place is reapplied from `answers` in the draft.
      if (question.id === "distance" && value && !isFixedArea(value)) return { questionId: question.id, answer: TYPED_AREA_ZONE };
      return { questionId: question.id, answer: question.id === "start_time" && value ? fromLocalInput(value) ?? value : value };
    })
      .filter((item) => item.answer);
    if (!filled.length) { if (draft) review(draft); return; }
    setBusy("answers"); setError(null);
    try { accept(await api.answerIntent(parsed.intent.id, filled), answers); }
    catch (err) { setError(errorMessage(err, "Could not read your answers. Try again or edit the details.")); }
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
      // Stays busy until the next screen appears, so the button can't come back in between.
      router.replace(rallyPath(rally.status, rally.id));
    } catch (err) {
      setError(errorMessage(err, "Could not publish your Rally."));
      setBusy(null);
    }
  };
  const set = (key: Exclude<keyof RallyDraft, "preferences">, value: string) =>
    setDraft((previous) => previous ? { ...previous, [key]: value, ...(key === "category" ? { preferences: {} } : {}) } : previous);
  const problem = draft ? rallyDraftProblem(draft) : null;
  const showField = (field: RallyDetail) => stage === "edit" || detailFields.includes(field);
  const visibleIssues = draft ? Object.entries(rallyDraftIssues(draft)).filter(([field]) => showField(field as RallyDetail)) : [];
  // Keeps the fields on screen and says what's wrong, instead of Continue appearing to do nothing.
  const continueDetails = () => {
    if (!draft) return;
    if (visibleIssues.length) setBlocked(true);
    else review(draft);
  };
  // Replaces the button under the user's thumb, so a slow request is visibly in progress.
  const busySlot = busy && <div className="busy-slot"><RallyLoader context={busy === "publish" ? "publish" : "plan"} /></div>;
  const start = draft ? fromLocalInput(draft.start) : null;
  const questions = parsed?.intent.questions ?? [];

  return <main className={`${inter.className} create-rally`}>
    <style>{`
      .create-rally { height:100dvh; background:#FFF5EF; color:#1C1917; display:flex; justify-content:center; }
      .create-rally .frame { width:100%; max-width:430px; height:100%; display:flex; flex-direction:column; }
      .create-rally .bar { padding:16px 24px; display:flex; justify-content:space-between; align-items:center; flex-shrink:0; }
      .create-rally .content { flex:1; min-height:0; overflow-y:auto; padding:12px 24px 24px; display:flex; flex-direction:column; gap:20px; }
      .create-rally h1 { margin:0; font-size:32px; font-weight:400; line-height:1.1; }
      .create-rally p { margin:0; color:#766B65; font-size:14px; line-height:1.5; }
      .create-rally label { display:flex; flex-direction:column; gap:8px; font-size:14px; font-weight:500; }
      .create-rally input,.create-rally textarea,.create-rally select { width:100%; min-height:48px; box-sizing:border-box; padding:12px; border:1px solid #D9C8BE; border-radius:12px; background:#FFFAF7; color:inherit; font:inherit; }
      .create-rally input:focus-visible,.create-rally textarea:focus-visible,.create-rally select:focus-visible { outline:2px solid #315FE8; outline-offset:2px; }
      .create-rally .fields { display:grid; gap:16px; }
      .create-rally .summary { padding:20px; border:1px solid #D9C8BE; border-radius:20px; background:#FFFAF7; display:grid; gap:16px; overflow-wrap:anywhere; }
      .create-rally .summary h2 { margin:0; font-size:24px; font-weight:500; line-height:1.3; }
      .create-rally .summary dl { margin:0; display:grid; gap:12px; }
      .create-rally .summary dl div { display:grid; grid-template-columns:70px 1fr; gap:12px; font-size:14px; }
      .create-rally dt { color:#766B65; }
      .create-rally dd { margin:0; }
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
      .create-rally .field-hint { font-size:13px; }
      .create-rally .area-field { display:grid; gap:10px; }
      .create-rally .area-option { min-height:40px; }
      .create-rally .area-option[aria-pressed="true"] { background:#315FE8; color:#FFF5EF; }
      .create-rally .busy-slot { display:flex; align-items:center; justify-content:center; min-height:52px; }
      .create-rally .busy-slot .rally-loader-wrap { padding:0; }
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
        <h1 className={serif.className}>{stage === "plan" ? "What are we rallying for?" : stage === "questions" || stage === "details" ? "A few details" : stage === "edit" ? "Edit your Rally" : "Ready to Rally?"}</h1>
        {stage === "plan" && <>
          <p>Describe what you want to do. Rally will use your profile and ask only for the details we still need.</p>
          <div className="orb-stage" aria-hidden="true"><RallyOrb variant="active" size={220} /></div>
        </>}
        {stage === "questions" && parsed && <>
          <p>{text}</p>
          {questions.filter((_, index) => index === questionIndex).map((question) => <div key={question.id} className="step-item">
            <p className="step">Question {questionIndex + 1} of {questions.length}</p>
            <label>
            <span>{question.text}</span>
            {question.id === "start_time" ? <input type="datetime-local" disabled={!!busy} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))} />
              : question.id === "distance" ? <AreaInput disabled={!!busy} value={answers[question.id] ?? ""} onChange={(value) => setAnswers((previous) => ({ ...previous, [question.id]: value }))} />
              : question.id === "group_fit" ? <SelectField disabled={!!busy} value={answers[question.id] ?? ""} options={VIBES.map((vibe) => ({ value: vibe.id, label: vibe.label }))} onChange={(value) => setAnswers((previous) => ({ ...previous, [question.id]: value }))} />
              : ["duration", "group_size"].includes(question.id) ? <input type="number" disabled={!!busy} min={question.id === "duration" ? 5 : 2} max={question.id === "duration" ? 480 : 12} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))} />
              : question.options ? <PreferenceInput disabled={!!busy} options={question.options} value={answers[question.id] ?? ""}
              onChange={(value) => setAnswers((previous) => ({ ...previous, [question.id]: value }))} />
              : <input disabled={!!busy} maxLength={120} value={answers[question.id] ?? ""} placeholder="Your answer"
                onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))} />}
            </label>
            {question.id === "distance" && <AreaOptions disabled={!!busy} value={answers[question.id] ?? ""} onChange={(value) => setAnswers((previous) => ({ ...previous, [question.id]: value }))} />}
          </div>)}
          <p>Only the details that help us form your Rally.</p>
        </>}
        {stage === "review" && draft && <>
          <p>Here&apos;s the plan. Create your Rally when it looks right.</p>
          <article className="summary" aria-label="Your Rally summary">
            <p>{categoryLabel(draft.category)}</p>
            <h2>{draft.goal}</h2>
            <dl>
              <div><dt>When</dt><dd>{start ? new Date(start).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Choose a start time"}</dd></div>
              <div><dt>Length</dt><dd>{draft.durationMin} minutes</dd></div>
              <div><dt>Where</dt><dd>{zoneLabel(draft.zone)}</dd></div>
              <div><dt>Who</dt><dd>{draft.groupMin === "2" && draft.capacity === "2" ? "You + one person" : `${draft.groupMin === draft.capacity ? draft.capacity : `${draft.groupMin}–${draft.capacity}`} people, including you`}</dd></div>
              {draft.vibe !== "any" && <div><dt>Vibe</dt><dd>{VIBES.find((vibe) => vibe.id === draft.vibe)?.label}</dd></div>}
            </dl>
            {Object.entries(draft.preferences).filter(([, value]) => value !== "any").map(([key, value]) => <p key={key}>{preferenceText(key, value)}</p>)}
          </article>
          {(parsed?.intent.source === "fallback" || parsed?.intent.durationMin === null) && !answers.duration && draft.durationMin === String(parsed?.intent.durationMin ?? 45) && <p>The suggested length is {draft.durationMin} minutes. You can change it in Edit details.</p>}
          {SENSITIVE_CATEGORIES.includes(draft.category) && <p>This Rally stays private and will not appear on the public map.</p>}
        </>}
        {(stage === "details" || stage === "edit") && draft && <>
          {stage === "details" && <p>We just need {detailFields.length === 1 ? "one more detail" : "these details"} for your plan: {draft.goal}</p>}
          <div className="fields">
            {showField("goal") && <label>What would you like to call your Rally?<input value={draft.goal} maxLength={160} disabled={!!busy} onChange={(event) => set("goal", event.target.value)} /></label>}
            {showField("category") && <label>What kind of activity is this?<SelectField value={draft.category} options={CATEGORIES.map((category) => ({ value:category.id, label:category.label }))} disabled={!!busy} onChange={(value) => set("category", value)} /></label>}
            {showField("start") && <label>{draft.category === "workshop" ? "What date and time does the workshop start?" : "When would you like to start?"}<input type="datetime-local" value={draft.start} disabled={!!busy} onChange={(event) => set("start", event.target.value)} /></label>}
            {showField("durationMin") && <label>About how many minutes?<input type="number" min={5} max={480} value={draft.durationMin} disabled={!!busy} onChange={(event) => set("durationMin", event.target.value)} /></label>}
            {(showField("groupMin") || showField("capacity")) && <div className="pair">
              <label>Minimum people<input type="number" min={2} max={12} value={draft.groupMin} disabled={!!busy} onChange={(event) => set("groupMin", event.target.value)} /></label>
              <label>Maximum people<input type="number" min={2} max={12} value={draft.capacity} disabled={!!busy} onChange={(event) => set("capacity", event.target.value)} /></label>
            </div>}
            {(showField("groupMin") || showField("capacity")) && <p>Group sizes include you.</p>}
            {showField("zone") && <div className="area-field">
              <label>Where would you like to meet?<AreaInput value={draft.zone} disabled={!!busy} onChange={(value) => set("zone", value)} /></label>
              <AreaOptions value={draft.zone} disabled={!!busy} onChange={(value) => set("zone", value)} />
            </div>}
            {showField("vibe") && <label>Group atmosphere<SelectField value={draft.vibe} options={VIBES.map((vibe) => ({ value:vibe.id, label:vibe.label }))} disabled={!!busy} onChange={(value) => set("vibe", value)} /></label>}
            {stage === "edit" && <PreferenceEditor categories={[draft.category]} preferences={draft.preferences} disabled={!!busy}
              onChange={(preferences) => setDraft((previous) => previous ? { ...previous, preferences } : previous)} />}
          </div>
        </>}
      </div>
      <div className="foot">
        {error && <p className="error" role="alert">{error}</p>}
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
          {busySlot || <button className="primary" disabled={!text.trim()} onClick={() => void parse()}>
            Continue
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>}
          <AiRequests requests={receipts.slice(-1)} />
        </>}
        {stage === "questions" && <>
          {questionIndex > 0 && <button className="link" disabled={!!busy} onClick={() => setQuestionIndex((index) => index - 1)}>Previous question</button>}
          {busySlot || <button className="primary" onClick={() => {
            if (questionIndex < questions.length - 1) setQuestionIndex((index) => index + 1);
            else void answer();
          }}>Continue</button>}
          <AiRequests requests={receipts.slice(-1)} />
          <button className="link" disabled={!!busy} onClick={() => { setError(null); setStage("edit"); }}>Edit details myself</button>
        </>}
        {stage === "review" && <>
          {problem && <p className="error" role="alert">{problem}</p>}
          {busySlot || <button className="primary" disabled={!!problem} onClick={() => void publish()}>Create Rally</button>}
          <AiRequests requests={receipts.slice(-1)} />
          <button className="link" disabled={!!busy} onClick={() => { setError(null); setStage("edit"); }}>Edit details</button>
          <button className="link" disabled={!!busy} onClick={() => { setError(null); setStage("plan"); }}>Change activity</button>
        </>}
        {(stage === "details" || stage === "edit") && draft && <>
          {blocked && visibleIssues[0] && <p className="error" role="alert">{visibleIssues[0][1]}</p>}
          <button className="primary" disabled={!!busy} onClick={continueDetails}>Continue</button>
          <AiRequests requests={receipts.slice(-1)} />
          {stage === "details" && <button className="link" disabled={!!busy} onClick={() => { setError(null); setStage("edit"); }}>Edit all details</button>}
        </>}
      </div>
    </div>
  </main>;
}
