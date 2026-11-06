"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Inter, Instrument_Serif } from "next/font/google";
import { Dropdown } from "@/components/Dropdown";
import { PreferenceEditor, PreferenceInput } from "@/components/PreferenceInput";
import { errorMessage, type ParsedIntent } from "@/lib/api";
import { CATEGORIES, SENSITIVE_CATEGORIES, VIBES, ZONES, rallyPath } from "@/lib/format";
import { clearRallyCreation } from "@/lib/plan";
import { draftFromIntent, rallyDraftProblem, rallyInputFromDraft, type RallyDraft } from "@/lib/rally-draft";
import { useSession } from "@/lib/session";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"] });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal" });

export default function CreateRallyScreen() {
  const { api } = useSession();
  const router = useRouter();
  const [stage, setStage] = useState<"plan" | "questions" | "review">("plan");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedIntent | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<RallyDraft | null>(null);
  const [busy, setBusy] = useState<"parse" | "answers" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submission = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => { clearRallyCreation(); }, []);

  const accept = (result: ParsedIntent) => {
    setParsed(result);
    setDraft(draftFromIntent(result.intent));
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
      .create-rally .primary { min-height:52px; padding:12px 20px; border:0; border-radius:999px; background:#315FE8; color:white; font:inherit; font-weight:600; cursor:pointer; }
      .create-rally .primary:disabled { background:#E8DFDA; color:#766B65; cursor:not-allowed; }
      .create-rally .link { min-height:44px; padding:0; border:0; background:transparent; color:#315FE8; font:inherit; cursor:pointer; }
      .create-rally .link:disabled { color:#766B65; cursor:not-allowed; }
      .create-rally .error { color:#A33A1E; }
    `}</style>
    <div className="frame">
      <nav className="bar" aria-label="Rally creation">
        <button className="link" disabled={busy === "publish"} onClick={() => { clearRallyCreation(); router.replace("/app/home"); }}>Cancel</button>
        <span style={{ fontSize:12, color:"#766B65" }}>Your own Rally</span>
      </nav>
      <div className="content">
        <h1 className={serif.className}>{stage === "plan" ? "What are we rallying for?" : stage === "questions" ? "A few details" : "Review your Rally"}</h1>
        {stage === "plan" && <>
          <p>Describe what you want to do. Rally will use your profile and ask up to three questions about this activity.</p>
          <label>Your plan<textarea rows={5} maxLength={500} disabled={!!busy} value={text} onChange={(event) => setText(event.target.value)} placeholder="Coffee tomorrow at 5 PM for half an hour?" /></label>
          <p>You will be the host. The default group is you and one guest.</p>
        </>}
        {stage === "questions" && parsed && <>
          <p>{text}</p>
          {parsed.intent.questions.map((question) => <label key={question.id}>
            <span>{question.text}</span>
            {question.options ? <PreferenceInput disabled={!!busy} options={question.options} value={answers[question.id] ?? ""}
              onChange={(value) => setAnswers((previous) => ({ ...previous, [question.id]: value }))} />
              : <input disabled={!!busy} maxLength={300} value={answers[question.id] ?? ""} placeholder="Your answer"
                onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))} />}
          </label>)}
          <p>You can also skip these and fill in the plan yourself.</p>
        </>}
        {stage === "review" && draft && <>
          <p>{parsed?.status === "needs_review" ? "Rally could not confirm every detail. Check and edit the plan before publishing." : "Check the details before we look for people to invite."}</p>
          <div className="fields">
            <label>Rally title<input value={draft.goal} maxLength={160} disabled={!!busy} onChange={(event) => set("goal", event.target.value)} /></label>
            <label>Activity<Dropdown ariaLabel="Activity" value={draft.category} options={CATEGORIES.map((category) => ({ value:category.id, label:category.label }))} disabled={!!busy} onChange={(value) => set("category", value)} /></label>
            <label>Start time<input type="datetime-local" value={draft.start} disabled={!!busy} onChange={(event) => set("start", event.target.value)} /></label>
            <label>Duration in minutes<input type="number" min={5} max={480} value={draft.durationMin} disabled={!!busy} onChange={(event) => set("durationMin", event.target.value)} /></label>
            <div className="pair">
              <label>Minimum people<input type="number" min={2} max={12} value={draft.groupMin} disabled={!!busy} onChange={(event) => set("groupMin", event.target.value)} /></label>
              <label>Maximum people<input type="number" min={2} max={12} value={draft.capacity} disabled={!!busy} onChange={(event) => set("capacity", event.target.value)} /></label>
            </div>
            <p>Group sizes include you.</p>
            <label>Meeting area<Dropdown ariaLabel="Meeting area" value={draft.zone} options={ZONES.map((zone) => ({ value:zone.id, label:zone.label }))} disabled={!!busy} onChange={(value) => set("zone", value)} /></label>
            <label>Group atmosphere<Dropdown ariaLabel="Group atmosphere" value={draft.vibe} options={VIBES.map((vibe) => ({ value:vibe.id, label:vibe.label }))} disabled={!!busy} onChange={(value) => set("vibe", value)} /></label>
            <PreferenceEditor categories={[draft.category]} preferences={draft.preferences} disabled={!!busy}
              onChange={(preferences) => setDraft((previous) => previous ? { ...previous, preferences } : previous)} />
            {SENSITIVE_CATEGORIES.includes(draft.category) && <p>This Rally stays private and will not appear on the public map.</p>}
          </div>
        </>}
        {busy && <p role="status">{busy === "publish" ? "Publishing your Rally…" : "Rally intelligence is reading your plan…"}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <div className="foot">
        {stage === "plan" && <button className="primary" disabled={!!busy || !text.trim()} onClick={() => void parse()}>Continue</button>}
        {stage === "questions" && <>
          <button className="primary" disabled={!!busy} onClick={() => void answer()}>Review plan</button>
          <button className="link" disabled={!!busy} onClick={() => { setError(null); setStage("review"); }}>Fill in the plan myself</button>
        </>}
        {stage === "review" && <>
          {problem && <p role="status">{problem}</p>}
          <button className="primary" disabled={!!busy || !!problem} onClick={() => void publish()}>Publish Rally</button>
          <button className="link" disabled={!!busy} onClick={() => { setError(null); setStage("plan"); }}>Change activity</button>
        </>}
      </div>
    </div>
  </main>;
}
