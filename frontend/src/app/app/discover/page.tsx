"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { errorMessage, getPreview, type PreviewActivity } from "@/lib/api";
import { bucketLabel, capitalize, categoryPhrase } from "@/lib/format";
import VenueMap from "@/components/VenueMap";
import RallyLogo from "@/components/RallyLogo";
import RallyLoader from "@/components/RallyLoader";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

export default function DiscoverScreen() {
  // Cards stay vague on purpose: activity in plain words, coarse zone, hour bucket, counts. No names.
  // Tapping a card opens why; it never joins anything — joining only happens through matching.
  const [open, setOpen] = useState(-1);
  const [activities, setActivities] = useState<PreviewActivity[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPage = useCallback(async (next?: string) => {
    setLoading(true);
    try {
      const page = await getPreview({ limit: 20, cursor: next });
      setActivities((prev) => (next ? [...prev, ...page.activities] : page.activities));
      setCursor(page.nextCursor);
      // Arkiv being down is not an error: show the notice and carry on.
      setNotice(page.available ? null : page.notice ?? "The live board is resting. We'll match you when it's back.");
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first page of an external API
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (loading) return;
    let alive = true;
    let refreshing = false;
    const timer = setInterval(async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try {
        const fresh: PreviewActivity[] = [];
        let next: string | undefined;
        let pagesLeft = Math.max(1, Math.ceil(activities.length / 20));
        do {
          const page = await getPreview({ limit: 20, cursor: next });
          if (!page.available) {
            if (alive) setNotice(page.notice);
            return;
          }
          fresh.push(...page.activities);
          next = page.nextCursor ?? undefined;
        } while (next && --pagesLeft > 0);
        if (alive) {
          setActivities(fresh);
          setCursor(next ?? null);
          setNotice(null);
        }
      } catch (err) {
        if (alive) setNotice(errorMessage(err));
      } finally {
        refreshing = false;
      }
    }, 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [activities.length, loading]);

  // One dot on the map per rally that still has room.
  const openRallies = useMemo(() => activities.filter((a) => a.status !== "full" && a.openSeats > 0), [activities]);
  const openCount = openRallies.length;

  return (
    <div
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      style={{ background: "#FFF5EF", height: "100dvh", display: "flex", justifyContent: "center", padding: "0" }}
    >
      <style>{`
        a { color: #1C1917; }
        a:hover { color: #315FE8; }
        .mono { font-family: ${MONO}; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #766B65; }
        .em { font-style: italic; color: #315FE8; }
        .card { background: #FFFAF7; border: 1px solid #D9C8BE; border-radius: 16px; transition: border-color .15s ease-out; }
        .act { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 64px; padding: 12px 16px; border: 0; border-radius: 16px; background: transparent; font-family: inherit; text-align: left; color: #1C1917; cursor: pointer; box-sizing: border-box; transition: background .12s ease-out; }
        .act:hover { background: #F7EEE9; }
        .act:focus-visible { outline: 2px solid #315FE8; outline-offset: -2px; }
        .stat { display: flex; align-items: center; justify-content: flex-end; gap: 6px; font-size: 12px; line-height: 1.3; }
        .dot { width: 9px; height: 9px; border-radius: 50%; box-sizing: border-box; flex-shrink: 0; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px; font-weight: 600; text-decoration: none; box-sizing: border-box; transition: transform .12s ease-out, background .12s ease-out; }
        .btn:active { transform: scale(.97); }
        .btn-p { height: 52px; font-size: 16px; background: #1C1917; color: #FFF5EF; }
        .btn-p:hover { background: #292421; color: #FFF5EF; }
        .btn-o { height: 40px; font-size: 14px; background: #315FE8; color: #FFF5EF; }
        .btn-o:hover { background: #2448C9; color: #FFF5EF; }
        .pulse { animation: pulse 1.8s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: .35; } }
        @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
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
        {/* Nav */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "56px",
            padding: "8px 24px 0",
            boxSizing: "border-box",
            flexShrink: 0,
          }}
        >
          <RallyLogo height={32} />
        </div>

        {/* Title */}
        <div style={{ padding: "16px 24px 0", flexShrink: 0 }}>
          <div className="mono">ETHGlobal Mumbai</div>
          <h1
            style={{
              margin: "6px 0 0",
              fontFamily: SERIF,
              fontWeight: 400,
              fontSize: "30px",
              lineHeight: 1.05,
              letterSpacing: "-0.015em",
            }}
          >
            What people are <span className="em">rallying for</span>
          </h1>
        </div>

        {/* Live cards */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 24px 0", display: "flex", flexDirection: "column", gap: "8px" }}>
          {notice && (
            <p role="status" style={{ margin: 0, fontSize: "14px", lineHeight: 1.45, color: "#766B65" }}>
              {notice}
            </p>
          )}
          {loading && !notice && activities.length === 0 && <RallyLoader context="discover" />}
          {!loading && !notice && activities.length === 0 && (
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.45, color: "#766B65" }}>
              Nothing is live yet. We&apos;ll match you in as soon as something fits.
            </p>
          )}
          {activities.map((c, i) => {
            const isOpen = open === i;
            return (
              <div key={c.opaqueId} className="card" style={{ flexShrink: 0, ...(isOpen ? { borderColor: "#315FE8" } : undefined) }}>
                <button
                  className="act"
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                    <span style={{ fontFamily: SERIF, fontSize: "19px", lineHeight: 1.15 }}>{categoryPhrase(c.category)}</span>
                    <span style={{ fontSize: "13px", color: "#766B65" }}>
                      <span style={{ fontFamily: MONO, color: "#1C1917" }}>{bucketLabel(c.startBucket)}</span>
                    </span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "4px", flexShrink: 0 }}>
                    <span className="stat" style={{ color: "#766B65" }}>
                      <span className="dot" style={{ border: "1.5px dashed #766B65" }} />
                      {c.status === "full" ? "Full" : `${c.openSeats} open`}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div
                    style={{
                      margin: "0 16px",
                      padding: "12px 0 16px",
                      borderTop: "1px solid #EADDD5",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.45 }}>
                      {capitalize(c.neededRole)} wanted. Happens with {c.minGroupSize} or more people.
                    </p>
                    <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.45, color: "#766B65" }}>
                      You&apos;ll be invited here if you&apos;re a fit — nothing to join by hand.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {cursor && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadPage(cursor)}
              style={{ flexShrink: 0, minHeight: "44px", border: 0, background: "transparent", fontFamily: "inherit", fontSize: "15px", fontWeight: 500, color: "#1C1917", cursor: "pointer" }}
            >
              {loading ? "Loading…" : "Show more"}
            </button>
          )}
        </div>

        {/* Venue map — one dot per open rally */}
        <div style={{ padding: "12px 0 0", flexShrink: 0 }}>
          <div className="mono" style={{ marginBottom: "8px", padding: "0 24px" }}>
            Around the venue · {openCount} open
          </div>
          <VenueMap rallies={openRallies} />
        </div>

        {/* CTA */}
        <div style={{ padding: "16px 24px 28px", display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
          <a className="btn btn-p" href="/app/home">
            Yes, let&apos;s Rally
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
          <p style={{ margin: 0, fontSize: "12px", color: "#766B65", textAlign: "center" }}>
            Preview only. No seat is held until you&apos;re matched.
          </p>
        </div>
      </div>
    </div>
  );
}
