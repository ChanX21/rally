"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { afterSignInPath, readPlan } from "@/lib/plan";
import { useSession } from "@/lib/session";

const Chevron = () => (
  <svg style={{ marginLeft: "auto" }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const noSubscribe = () => () => {};

// The plan typed before signing in. Empty on the server, read from sessionStorage on the client.
export function PendingPlan({ fontFamily }: { fontFamily: string }) {
  const text = useSyncExternalStore(noSubscribe, () => readPlan()?.text ?? null, () => null);
  if (!text) return null;
  return (
    <div style={{ padding: "16px", borderRadius: "16px", background: "#F8DDD3" }}>
      <div className="mono" style={{ color: "#1C1917" }}>
        Your plan
      </div>
      <div style={{ marginTop: "8px", fontFamily, fontSize: "20px", lineHeight: 1.2 }}>&quot;{text}&quot;</div>
    </div>
  );
}

export default function WalletButtons() {
  const { status, me, error, login, retry } = useSession();
  const router = useRouter();

  // AppGate leaves this page alone, so routing after the handshake happens here.
  useEffect(() => {
    if (status === "ready" && me) router.replace(afterSignInPath(me.user.onboarded));
  }, [status, me, router]);

  const onConnect = () => {
    if (status === "error") retry();
    else login();
  };

  const disabled = status === "loading" || status === "ready" || status === "unconfigured" || status === "suspended";
  const message =
    status === "loading"
      ? "Signing you in…"
      : status === "unconfigured" || status === "suspended" || status === "error"
        ? error
        : null;

  return (
    <>
      <button type="button" className="wal" onClick={onConnect} disabled={disabled}>
        <span className="logo" style={{ background: "#F6851B" }} title="Replace with the official MetaMask mark">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="6" width="18" height="13" rx="3" />
            <path d="M16 12.5h2M3 9h15" />
          </svg>
        </span>
        MetaMask
        <Chevron />
      </button>
      <button type="button" className="wal" onClick={onConnect} disabled={disabled}>
        <span className="logo" style={{ background: "#FFF5EF", border: "1px solid #D9C8BE" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="6" cy="12" r="1.4" />
            <circle cx="12" cy="12" r="1.4" />
            <circle cx="18" cy="12" r="1.4" />
          </svg>
        </span>
        Other wallet
        <Chevron />
      </button>
      {message && (
        <div className="mono" style={{ textAlign: "center", color: status === "loading" ? undefined : "#EC562E" }} role="status">
          {message}
        </div>
      )}
    </>
  );
}
