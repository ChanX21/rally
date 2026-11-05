"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { afterSignInPath } from "@/lib/plan";
import { useSession } from "@/lib/session";

// Readable without login: the QR preview, the prompt, and the login sheet itself.
const PUBLIC_PATHS = ["/app/discover", "/app/home", "/app/connect-wallet"];
// Never pulled into onboarding, so people can browse first.
const NO_ONBOARDING_REDIRECT = ["/app/discover", "/app/connect-wallet"];
const ONBOARDING_PATH = "/app/about-you";

function Notice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{ background: "#FFF5EF", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", padding: "24px", textAlign: "center", color: "#1C1917", fontSize: "15px", lineHeight: 1.45 }}>
      <span role="status" style={{ maxWidth: "320px" }}>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{ height: "44px", padding: "0 20px", borderRadius: "999px", border: "1px solid #1C1917", background: "transparent", color: "#1C1917", fontFamily: "inherit", fontSize: "15px", fontWeight: 500, cursor: "pointer" }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

export default function AppGate({ children }: { children: React.ReactNode }) {
  const { status, me, error, retry } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const onboarded = me?.user.onboarded ?? false;

  let redirect: string | null = null;
  if (status === "signed-out" && !isPublic) redirect = "/app/connect-wallet";
  if (status === "ready") {
    if (!onboarded && pathname !== ONBOARDING_PATH && !NO_ONBOARDING_REDIRECT.includes(pathname)) {
      redirect = ONBOARDING_PATH;
    }
    // POST /onboarding/complete only works once. Later edits use the profile screen.
    if (onboarded && pathname === ONBOARDING_PATH) redirect = afterSignInPath(true);
  }

  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  if (isPublic && !redirect) return <>{children}</>;
  if (status === "unconfigured" || status === "suspended") return <Notice message={error ?? "This account can't sign in."} />;
  if (status === "error") return <Notice message={error ?? "Could not sign you in."} onRetry={retry} />;
  if (status === "loading" || redirect) return <Notice message="One moment…" />;
  return <>{children}</>;
}
