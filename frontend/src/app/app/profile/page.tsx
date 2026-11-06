"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallets } from "@privy-io/react-auth";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { errorMessage, type ProfileUpdate } from "@/lib/api";
import { CATEGORIES, categoryLabel, preferenceNotes, preferencesFromNotes, rewardLabel, signedPoints, toLocalInput, fromLocalInput } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "normal", variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const SANS = "var(--font-inter), system-ui, sans-serif";
const SERIF = "var(--font-serif), Georgia, serif";
const MONO = "var(--font-mono), monospace";

// Sensitive categories aren't offered as public-facing interests, same as onboarding.
const INTEREST_OPTIONS = CATEGORIES.filter((c) => !["wellness", "support"].includes(c.id));

export default function ProfileScreen() {
  // Private profile: display name, top interests, what the user told Rally, and the matching switch.
  const { api, me, setMe, logout } = useSession();
  const router = useRouter();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [interestDraft, setInterestDraft] = useState<string[] | null>(null);
  const [preferenceDraft, setPreferenceDraft] = useState<{ text: string; version: number } | null>(null);
  const [availabilityDraft, setAvailabilityDraft] = useState<{ start: string; end: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const { data: rewards, refresh: refreshRewards } = usePolled(useCallback(() => api.getRewards(), [api]), 30_000);
  const { data: refreshedMe } = usePolled(useCallback(() => api.getMe(), [api]), 15_000);
  const { wallets } = useWallets();
  // A Rally-created wallet has no app to show tokens in, so only an external one can add RALLY.
  const externalWallet = wallets.find((wallet) => wallet.walletClientType !== "privy");
  const [walletNote, setWalletNote] = useState<string | null>(null);
  const history = rewards?.entries.slice(0, 5) ?? [];

  const appeal = async (rallyId: string) => {
    setError(null);
    try {
      await api.raiseDispute(rallyId, { category: "no_show_appeal" });
      refreshRewards();
    } catch (err) {
      setError(errorMessage(err, "Could not send that."));
    }
  };

  // Optional. RALLY only shows in a wallet once it knows about Arc and the token.
  const addToWallet = async () => {
    const chain = rewards?.chain;
    const wallet = externalWallet;
    if (!chain || !wallet) return;
    setWalletNote(null);
    try {
      const provider = await wallet.getEthereumProvider();
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${chain.chainId.toString(16)}`,
            chainName: "Arc Testnet",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: chain.rpcUrl ? [chain.rpcUrl] : [],
            blockExplorerUrls: [chain.explorerUrl],
          },
        ],
      });
      await provider.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: chain.tokenAddress, symbol: "RALLY", decimals: 0 } },
      } as never);
      setWalletNote("RALLY added to your wallet.");
    } catch {
      setWalletNote("Your wallet didn't add it. You can still see everything here.");
    }
  };

  // A background feedback update may arrive after login; don't replace a newer local save.
  const currentMe = (refreshedMe?.profile?.version ?? 0) > (me?.profile?.version ?? 0) ? refreshedMe : me;
  const savedName = currentMe?.user.displayName ?? "";
  const name = nameDraft ?? savedName;
  const profile = currentMe?.profile ?? null;
  const notes = preferenceDraft?.text ?? preferenceNotes(profile?.preferences ?? {});

  const save = async (update: ProfileUpdate) => {
    setSaving(true);
    setError(null);
    setSaveNote(null);
    try {
      const saved = await api.updateProfile(update);
      setMe(saved);
      if (update.preferences || update.interests || update.availableFrom || update.availableTo || update.optInMatching === true) {
        setSaveNote(saved.user.optInMatching
          ? "Saved. Rally is checking existing activities within your availability. You'll get an invitation if there's a fit."
          : "Saved. Turn on Open to matches to receive invitations.");
      }
      return true;
    } catch (err) {
      setError(errorMessage(err, "Could not save that."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === savedName) {
      setNameDraft(null);
      return;
    }
    if (await save({ displayName: trimmed })) setNameDraft(null);
  };

  const saveInterests = async () => {
    if (!interestDraft || interestDraft.length !== 3) return;
    if (await save({ interests: interestDraft })) setInterestDraft(null);
  };

  const toggleInterest = (id: string) => {
    if (!interestDraft) return;
    if (interestDraft.includes(id)) setInterestDraft(interestDraft.filter((i) => i !== id));
    else if (interestDraft.length < 3) setInterestDraft([...interestDraft, id]);
  };

  const setMatching = (on: boolean) => {
    if (!on) {
      void save({ optInMatching: false });
      return;
    }
    // Matching needs an availability window. Keep one that's still running,
    // otherwise default to the next 12 hours, as onboarding does.
    const until = profile?.availableTo ? new Date(profile.availableTo).getTime() : 0;
    const window =
      until > Date.now()
        ? {}
        : { availableFrom: new Date().toISOString(), availableTo: new Date(Date.now() + 12 * 3_600_000).toISOString() };
    void save({ optInMatching: true, ...window });
  };

  const signOut = async () => {
    await logout();
    router.replace("/app/discover");
  };

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
        .head button { padding: 0; border: 0; background: transparent; font-family: inherit; font-size: 14px; font-weight: 600; color: #315FE8; min-height: 32px; display: flex; align-items: center; cursor: pointer; }
        .head button:disabled { color: #766B65; cursor: not-allowed; }
        .pick { border: 1px solid #D9C8BE; background: #FFFAF7; font-family: inherit; color: #1C1917; cursor: pointer; }
        .sw { appearance: none; -webkit-appearance: none; width: 52px; height: 32px; margin: 0; border-radius: 999px; background: #E8DFDA; position: relative; cursor: pointer; flex-shrink: 0; transition: background .15s ease-out; }
        .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%; background: #FFFAF7; transition: transform .15s ease-out; }
        .sw:checked { background: #1C1917; }
        .sw:checked::after { transform: translateX(20px); }
        .sw:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        input[type=text]:focus, textarea:focus-visible { outline: 2px solid #315FE8; outline-offset: 2px; }
        .availability-field { display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
        .availability-field input { width: 100%; min-height: 48px; box-sizing: border-box; padding: 10px 12px; border: 1px solid #D9C8BE; border-radius: 12px; font: inherit; background: #FFFAF7; color: #1C1917; }
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

        <div style={{ flex: 1, minHeight: 0, padding: "20px 24px 0", display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto" }}>
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
              maxLength={60}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void saveName()}
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
              {interestDraft ? (
                <button type="button" disabled={saving || interestDraft.length !== 3} onClick={() => void saveInterests()}>
                  {interestDraft.length === 3 ? "Save" : `Pick ${3 - interestDraft.length} more`}
                </button>
              ) : (
                <button type="button" onClick={() => setInterestDraft(profile?.interests ?? [])}>
                  Edit
                </button>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {interestDraft
                ? INTEREST_OPTIONS.map((c) => {
                    const on = interestDraft.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className="tag pick"
                        aria-pressed={on}
                        onClick={() => toggleInterest(c.id)}
                        style={on ? { background: "#E5ECFF", borderColor: "#315FE8" } : undefined}
                      >
                        {c.label}
                      </button>
                    );
                  })
                : (profile?.interests ?? []).map((id) => (
                    <span key={id} className="tag" style={{ background: "#E5ECFF" }}>
                      {categoryLabel(id)}
                    </span>
                  ))}
            </div>
          </div>

          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="head">
              <label htmlFor="matching-preferences" className="mono">About your preferences</label>
              <button type="button" disabled={saving || !preferenceDraft || notes.length > 4000} onClick={async () => {
                if (preferenceDraft && await save({ preferences: preferencesFromNotes(notes, profile?.preferences ?? {}), expectedProfileVersion: preferenceDraft.version })) setPreferenceDraft(null);
              }}>Save</button>
            </div>
            <p id="preference-help" style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: "#766B65" }}>Tell Rally what you enjoy and who you&apos;d like to meet. Write naturally, add a line, or change anything here.</p>
            <textarea id="matching-preferences" aria-describedby="preference-help preference-length" disabled={saving || !profile} rows={8} maxLength={4000}
              value={notes} onChange={(event) => setPreferenceDraft({ text: event.target.value, version: preferenceDraft?.version ?? profile!.version })}
              placeholder={"I like building at hackathons and playing Valorant.\nI'd love to try candle-making workshops.\nFor food, I prefer sitting down together."}
              style={{ width: "100%", minHeight: 220, boxSizing: "border-box", resize: "vertical", padding: 14, border: "1px solid #D9C8BE", borderRadius: 16, background: "#FFFAF7", color: "#1C1917", font: "inherit", fontSize: 15, lineHeight: 1.6 }} />
            <span id="preference-length" style={{ fontSize: 12, color: "#766B65" }}>{notes.length}/4000 · Saved changes restart matching when you&apos;re open to invites.</span>
            {preferenceDraft && <button type="button" className="pick tag" disabled={saving} onClick={() => setPreferenceDraft(null)}>Cancel edits</button>}
            {profile && <span style={{ fontSize: 12, color: "#766B65" }}>Profile last updated {new Date(profile.lastUpdatedAt).toLocaleString()}</span>}
          </section>

          {(profile?.declaredSkills.length ?? 0) > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="mono">Skills you shared</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {profile!.declaredSkills.map((t, index) => (
                  <span key={`${index}:${t}`} className="tag" style={{ border: "1px solid #D9C8BE", maxWidth: "100%", height: "auto", minHeight: 32, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="mono">From Rally feedback</span>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: "#766B65" }}>Vouches record what others appreciated. They don&apos;t overwrite your preferences.</p>
            {profile?.evidence?.length ? <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6, overflowWrap: "anywhere" }}>
              {profile.evidence.map((entry, index) => <li key={`${entry.rallyId}:${index}`}>
                {entry.contribution} <span style={{ color: "#766B65", fontSize: 12 }}>— Vouch, {new Date(entry.at).toLocaleDateString()}</span>
              </li>)}
            </ul> : <span style={{ fontSize: 14, color: "#766B65" }}>No vouches recorded yet.</span>}
          </section>

          {saveNote && <p role="status" style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: "#315FE8" }}>{saveNote}</p>}

          <label className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 16px", cursor: "pointer" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "15px", fontWeight: 600 }}>Open to matches</span>
              <span style={{ fontSize: "13px", color: "#766B65" }}>Rally always asks before adding you</span>
            </span>
            <input
              className="sw"
              type="checkbox"
              role="switch"
              disabled={saving}
              checked={currentMe?.user.optInMatching ?? false}
              onChange={(e) => setMatching(e.target.checked)}
            />
          </label>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="head">
              <span className="mono">Availability</span>
              <button type="button" disabled={saving} onClick={() => setAvailabilityDraft({
                start: toLocalInput(profile?.availableFrom ?? new Date().toISOString()),
                end: toLocalInput(profile?.availableTo ?? new Date(Date.now() + 12 * 3_600_000).toISOString()),
              })}>Edit availability</button>
            </div>
            {availabilityDraft ? <>
              <label className="availability-field">Available from<input disabled={saving} type="datetime-local" value={availabilityDraft.start} onChange={(e) => setAvailabilityDraft({ ...availabilityDraft, start: e.target.value })} /></label>
              <label className="availability-field">Available until<input disabled={saving} type="datetime-local" value={availabilityDraft.end} onChange={(e) => setAvailabilityDraft({ ...availabilityDraft, end: e.target.value })} /></label>
              <button className="pick tag" type="button" disabled={saving} onClick={async () => {
                const start = fromLocalInput(availabilityDraft.start), end = fromLocalInput(availabilityDraft.end);
                if (!start || !end || new Date(end) <= new Date(start) || new Date(end) <= new Date()) {
                  setError("Choose an availability window ending in the future."); return;
                }
                if (await save({ availableFrom: start, availableTo: end })) setAvailabilityDraft(null);
              }}>Save availability</button>
              <button className="pick tag" type="button" disabled={saving} onClick={() => setAvailabilityDraft(null)}>Cancel</button>
            </> : <span style={{ fontSize: 14, color: "#766B65" }}>
              {profile?.availableTo ? `${new Date(profile.availableTo) > new Date() ? "Available until" : "Availability ended"} ${new Date(profile.availableTo).toLocaleString()}` : "Set when you are free to receive invites."}
            </span>}
          </section>

          {rewards && (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "16px" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "15px", fontWeight: 600 }}>RALLY</span>
                  <span style={{ fontSize: "13px", color: "#766B65" }}>{rewards.tier}</span>
                </span>
                <span style={{ fontFamily: MONO, fontSize: "20px" }}>{rewards.net}</span>
              </div>
              {history.map((entry) => (
                <div key={entry.id} style={{ display: "flex", flexDirection: "column", gap: "4px", paddingTop: "8px", borderTop: "1px solid #D9C8BE" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "14px" }}>
                    <span>{rewardLabel(entry.action)}</span>
                    <span style={{ fontFamily: MONO }}>
                      {entry.state === "applied" ? signedPoints(entry.points) : `${signedPoints(entry.points)} if confirmed`}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "13px", color: "#766B65" }}>
                    <span>{entry.state === "held" ? "Being reviewed" : new Date(entry.createdAt).toLocaleDateString()}{entry.action === "RallyCompleted" && !entry.chainTxHash ? " · saved in app" : ""}</span>
                    {entry.state === "pending" && entry.action === "NoShow" && entry.rallyId && (
                      <button
                        type="button"
                        onClick={() => void appeal(entry.rallyId ?? "")}
                        style={{ padding: 0, minHeight: "32px", border: 0, background: "transparent", fontFamily: "inherit", fontSize: "14px", fontWeight: 600, color: "#315FE8", cursor: "pointer" }}
                      >
                        I was there
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {rewards.chain?.address && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", paddingTop: "8px", borderTop: "1px solid #D9C8BE", fontSize: "14px", fontWeight: 600 }}>
                  <a href={`${rewards.chain.explorerUrl}/address/${rewards.chain.address}`} target="_blank" rel="noreferrer" style={{ color: "#315FE8" }}>
                    Verified on Arc
                  </a>
                  {externalWallet && (
                    <button
                      type="button"
                      onClick={() => void addToWallet()}
                      style={{ padding: 0, minHeight: "32px", border: 0, background: "transparent", fontFamily: "inherit", fontSize: "14px", fontWeight: 600, color: "#315FE8", cursor: "pointer" }}
                    >
                      Add to wallet
                    </button>
                  )}
                </div>
              )}
              {walletNote && (
                <span role="status" style={{ fontSize: "13px", color: "#766B65" }}>
                  {walletNote}
                </span>
              )}
            </div>
          )}

          {error && (
            <p role="alert" style={{ margin: 0, fontSize: "14px", lineHeight: 1.45, color: "#EC562E" }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void signOut()}
            style={{ flexShrink: 0, minHeight: "44px", padding: 0, border: 0, background: "transparent", fontFamily: "inherit", fontSize: "15px", fontWeight: 500, color: "#766B65", textDecoration: "underline", cursor: "pointer" }}
          >
            Sign out
          </button>
        </div>
        <div style={{ height: "28px", flexShrink: 0 }} />
      </div>
    </div>
  );
}
