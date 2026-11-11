"use client";

import { useCallback, useState } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import type { Rally } from "@/lib/api";
import { errorMessage } from "@/lib/api";
import { categoryLabel, durationLabel, rallyPath, shortPlace } from "@/lib/format";
import { myRallySections } from "@/lib/my-rallies";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";
import PlaceTag from "@/components/PlaceTag";
import RallyLoader from "@/components/RallyLoader";
import { CREATE_RALLY_PATH } from "@/lib/plan";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"] });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: "400" });
const LABELS: Record<string, string> = { draft: "Draft", open: "Finding your crew", waiting: "Finding your crew", proposed: "Invites sent", ready: "Group ready", formed: "Confirmed", met: "Share feedback", completed: "Completed", cancelled: "Cancelled", expired: "Expired" };
const dateLabel = (value: string) => new Date(value).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function MyRalliesScreen() {
  const { api, me } = useSession();
  const [tab, setTab] = useState<"current" | "invitations" | "past">("current");
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [savingPlace, setSavingPlace] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const load = useCallback(async () => {
    const [first, matches] = await Promise.all([api.listRallies({ limit: 100 }), api.listMatches({ limit: 100 })]);
    const items = [...first.items];
    let nextCursor = first.nextCursor;
    for (let page = 1; page < pages && nextCursor; page++) {
      const next = await api.listRallies({ limit: 100, cursor: nextCursor });
      items.push(...next.items);
      nextCursor = next.nextCursor;
    }
    return { ...myRallySections(items, matches.matches, Date.now()), waiting: matches.waiting, nextCursor, pages };
  }, [api, pages]);
  const { data, error, loaded, refresh } = usePolled(load, 15_000);
  const rows = tab === "current" ? data?.current ?? [] : data?.past ?? [];

  const rallyCard = (rally: Rally) => {
    const host = rally.creatorId === me?.user.id;
    const action = rally.status === "ready" && host ? "Set meeting point" : rally.status === "formed" ? "Go to rally point" : rally.status === "met" ? "Share feedback" : "View rally";
    return <article key={rally.id} className="rally-card">
      <a href={rallyPath(rally.status, rally.id)}>
      <div className="card-top"><span className="eyebrow">{host ? "Hosting" : "Joined"} · {categoryLabel(rally.category)}</span><span className="badge">{LABELS[rally.status] ?? rally.status}</span></div>
      <h2 className={serif.className}>{rally.goal}</h2>
      <p>{dateLabel(rally.meetAt ?? rally.windowStart)}</p>
      <p>{durationLabel(rally.durationMin)} · Up to {rally.capacity} people{rally.openSeats > 0 && !["completed", "cancelled", "expired"].includes(rally.status) ? ` · ${rally.openSeats} open` : ""}</p>
      <span className="action" style={{ display: "block" }}>{action} ↗</span>
      </a>
      <div style={{ marginTop: 12 }}><PlaceTag place={rally.publicPlace ?? rally.meetingPoint} /></div>
      {host && rally.visibility === "public_coarse" && !["met", "completed", "cancelled", "expired"].includes(rally.status) && <details style={{ marginTop: 12, fontSize: 12 }}><summary style={{ cursor: "pointer", color: "#315FE8", minHeight: 32 }}>Edit public place</summary>
        <form onSubmit={async event => {
          event.preventDefault();
          const publicPlace = String(new FormData(event.currentTarget).get("publicPlace") ?? "").trim();
          setSavingPlace(rally.id); setPlaceError(null);
          try { await api.updateRally(rally.id, { expectedVersion: rally.version, publicPlace: publicPlace || null }); refresh(); }
          catch (err) { setPlaceError(errorMessage(err)); }
          finally { setSavingPlace(null); }
        }}>
          <label>Public place name<input name="publicPlace" maxLength={120} defaultValue={rally.publicPlace ?? shortPlace(rally.meetingPoint ?? "")} placeholder="e.g. Mumbai Airport T1" style={{ width: "100%", padding: 10, marginTop: 8, border: "1px solid #D9C8BE", borderRadius: 12, font: "inherit" }} /></label>
          <p>Visible on the live board with a Maps link. Clear this field to hide it. Keep exact meeting instructions private.</p>
          <button type="submit" disabled={savingPlace !== null} style={{ marginTop: 8, padding: "10px 14px", background: "#315FE8", color: "#FFF5EF", border: 0, borderRadius: 999 }}>{savingPlace === rally.id ? "Saving…" : "Save public place"}</button>
        </form>
      </details>}
    </article>;
  };

  return <main className={`${inter.className} my-rallies`}>
    <style>{`
      .my-rallies { height:100dvh; min-height:0; overflow-y:auto; overscroll-behavior-y:contain; -webkit-overflow-scrolling:touch; background:#FFF5EF; color:#1C1917; padding:24px; padding-bottom:calc(24px + env(safe-area-inset-bottom)); box-sizing:border-box; }
      .my-rallies .wrap { max-width:430px; margin:auto; display:flex; flex-direction:column; gap:24px; }
      .my-rallies a { color:inherit; text-decoration:none; }
      .my-rallies .topbar,.my-rallies .card-top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .my-rallies .back { display:grid; place-items:center; height:44px; width:44px; border:1px solid #D9C8BE; border-radius:50%; }
      .my-rallies h1 { font-size:42px; line-height:1.05; font-weight:400; margin:0; }
      .my-rallies h1 em { color:#315FE8; }
      .my-rallies p { margin:8px 0 0; font-size:14px; line-height:1.5; color:#766B65; }
      .my-rallies .tabs { display:flex; gap:4px; padding:4px; background:#EFE7E2; border-radius:999px; }
      .my-rallies .tabs button { flex:1; min-height:44px; padding:8px; border:0; border-radius:999px; background:transparent; color:#766B65; font:inherit; font-size:13px; cursor:pointer; }
      .my-rallies .tabs button[aria-pressed=true] { background:#1C1917; color:#FFF5EF; }
      .my-rallies .rally-card { display:flex; flex-direction:column; padding:20px; background:#FFFAF7; border:1px solid #D9C8BE; border-radius:24px; }
      .my-rallies h2 { margin:16px 0 4px; font-weight:400; font-size:26px; line-height:1.15; overflow-wrap:anywhere; }
      .my-rallies .eyebrow { font-size:11px; color:#766B65; }
      .my-rallies .badge { font-size:11px; padding:6px 9px; background:#E5ECFF; color:#315FE8; border-radius:999px; }
      .my-rallies .action { color:#315FE8; font-size:14px; font-weight:600; margin-top:16px; }
      .my-rallies .list { display:flex; flex-direction:column; gap:12px; }
      .my-rallies .empty { padding:28px 20px; border:1px dashed #D9C8BE; border-radius:24px; }
      .my-rallies .primary { display:block; border:0; border-radius:999px; padding:16px 20px; background:#1C1917; color:#FFF5EF; font:inherit; text-align:center; cursor:pointer; }
      .my-rallies button:focus-visible,.my-rallies a:focus-visible { outline:2px solid #315FE8; outline-offset:4px; }
    `}</style>
    <div className="wrap">
      <nav className="topbar" aria-label="Account"><a className="back" href="/app/home" aria-label="Back to home">←</a><a href="/app/inbox">Notifications</a><a href="/app/profile">Profile</a></nav>
      <header><span className={mono.className} style={{ fontSize: 11, letterSpacing: ".08em", color: "#766B65" }}>YOUR PLANS, TOGETHER</span><h1 className={serif.className}>My <em>rallies</em></h1><p>Plans you host, crews you join, and invitations waiting for you.</p></header>
      <div className="tabs" role="group" aria-label="Rally view">
        {([['current', 'Current'], ['invitations', 'Invitations'], ['past', 'Past']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}{data ? ` (${data[key].length + (key === "current" ? data.waiting.length : 0)})` : ""}</button>)}
      </div>
      {placeError && <p role="alert">{placeError}</p>}
      {Boolean(error) && <div role="alert"><p>{errorMessage(error)}</p><button type="button" onClick={refresh}>Try again</button></div>}
      {!loaded && <RallyLoader context="plan" />}
      {data && <div className="list">
        {tab === "invitations" ? data.invitations.map(match => <article key={match.id} className="rally-card"><a href={`/app/match-found?id=${match.id}`}>
          <div className="card-top"><span className="eyebrow">MATCH FOUND</span><span className="badge">Needs your answer</span></div>
          <h2 className={serif.className}>{match.rally.goal}</h2><p>{dateLabel(match.rally.windowStart)} · {durationLabel(match.rally.durationMin)}</p><p>{match.reason}</p><p>Reply by {dateLabel(match.holdUntil)}</p><span className="action">Review invitation ↗</span>
        </a><div style={{ marginTop: 12 }}><PlaceTag place={match.rally.publicPlace} /></div></article>) : rows.map(rallyCard)}
        {tab === "current" && data.waiting.map(intent => <a className="rally-card" key={intent.id} href={`/app/no-fit?intent=${intent.id}`}><span className="badge">Looking for a fit</span><h2 className={serif.className}>{intent.goal ?? "Your next rally"}</h2><p>We’ll notify you when a compatible plan comes up.</p></a>)}
        {(tab === "invitations" ? data.invitations.length === 0 : rows.length === 0 && (tab !== "current" || data.waiting.length === 0)) && <div className="empty"><h2 className={serif.className}>{tab === "invitations" ? "No invitations waiting" : tab === "past" ? "Your story starts here" : "Room for a new plan"}</h2><p>{tab === "invitations" ? "New matches will appear here and in Notifications." : tab === "past" ? "Finished, cancelled and expired rallies will appear here." : "Create a rally or turn on matching in your profile."}</p></div>}
      </div>}
      {data?.nextCursor && <button type="button" className="primary" disabled={data.pages < pages} onClick={() => setPages(value => value + 1)}>{data.pages < pages ? "Loading…" : "Load more rallies"}</button>}
      <a className="primary" href={CREATE_RALLY_PATH}>Create a rally</a>
    </div>
  </main>;
}
