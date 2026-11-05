"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSession, getMe, RallyApiError } from "@/lib/api";

const PRIVY_CONFIGURED = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

const Chevron = () => (
  <svg style={{ marginLeft: "auto" }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export default function WalletButtons() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const running = useRef(false);
  const autoRan = useRef(false);

  // Backend handshake for an authenticated Privy user:
  // POST /auth/session (creates the user) → GET /me → route by onboarding state.
  // Guarded by `running` so concurrent triggers (effect + click) don't double-run,
  // but any failure clears the guard so it can be retried.
  const runHandshake = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setStatus("Signing you in…");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Privy returned no access token");
      await createSession(token);
      const me = await getMe(token);
      router.push(me.user.onboarded ? "/app/discover" : "/app/about-you");
    } catch (err) {
      const msg =
        err instanceof RallyApiError
          ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
          : err instanceof Error
            ? err.message
            : "Something went wrong";
      setStatus(msg);
    } finally {
      running.current = false;
    }
  }, [getAccessToken, router]);

  // Fire the handshake once, automatically, when Privy first reports an
  // authenticated user. Retries after a failure go through the button, not here,
  // so a transient error never becomes an auto-retry loop.
  useEffect(() => {
    if (ready && authenticated && !autoRan.current) {
      autoRan.current = true;
      runHandshake();
    }
  }, [ready, authenticated, runHandshake]);

  const onConnect = useCallback(() => {
    setStatus(null);
    // Dev fallback: no Privy app id → keep the mockup navigable.
    if (!PRIVY_CONFIGURED) {
      router.push("/app/about-you");
      return;
    }
    // Already logged in (e.g. retry after a transient handshake failure): the
    // modal won't reopen, so run the handshake directly instead of bailing.
    if (authenticated) {
      runHandshake();
      return;
    }
    login();
  }, [authenticated, login, router, runHandshake]);

  const disabled = PRIVY_CONFIGURED && !ready;

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
      {status && (
        <div className="mono" style={{ textAlign: "center", color: "#EC562E" }} role="status">
          {status}
        </div>
      )}
    </>
  );
}
