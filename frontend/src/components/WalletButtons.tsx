"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { afterSignInPath } from "@/lib/plan";
import RallyLoader from "@/components/RallyLoader";
import { useSession } from "@/lib/session";

const Chevron = () => (
  <svg style={{ marginLeft: "auto" }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export default function WalletButtons() {
  const { status, me, error, loginError, openingGoogle, connectWallet, loginWithGoogle, retry } = useSession();
  const router = useRouter();

  // AppGate leaves this page alone, so routing after the handshake happens here.
  useEffect(() => {
    if (status === "ready" && me) router.replace(afterSignInPath(me.user.onboarded));
  }, [status, me, router]);

  const onConnect = (start: () => void) => {
    if (status === "error") retry();
    else start();
  };

  const disabled = openingGoogle || status === "loading" || status === "ready" || status === "unconfigured" || status === "suspended";
  const message = status === "unconfigured" || status === "suspended" || status === "error" ? error : loginError;

  return (
    <>
      <button type="button" className="wal" onClick={() => onConnect(connectWallet)} disabled={disabled}>
        <span className="logo" style={{ background: "#FFF5EF", border: "1px solid #D9C8BE" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="6" width="18" height="13" rx="3" />
            <path d="M16 12.5h2M3 9h15" />
          </svg>
        </span>
        Connect wallet
        <Chevron />
      </button>
      <button type="button" className="wal" onClick={() => onConnect(loginWithGoogle)} disabled={disabled}>
        <span className="logo" style={{ background: "#FFFFFF", border: "1px solid #D9C8BE" }}>
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
        </span>
        {openingGoogle ? "Opening Google…" : "Continue with Google"}
        <Chevron />
      </button>
      <div style={{ textAlign: "center", fontSize: "13px", color: "#766B65" }}>No wallet? Google sets one up for you.</div>
      {status === "loading" ? <RallyLoader context="signin" /> : message && (
        <div className="mono" style={{ textAlign: "center", color: "#EC562E" }} role="status">
          {message}
        </div>
      )}
    </>
  );
}
