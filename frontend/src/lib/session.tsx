"use client";

import { getAccessToken, PrivyProvider, useLoginWithOAuth, usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createApiClient, errorCode, errorMessage, type ApiClient, type Me } from "@/lib/api";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export type SessionStatus =
  | "unconfigured" // no NEXT_PUBLIC_PRIVY_APP_ID, so login cannot work
  | "loading" // Privy is starting, or the backend handshake is running
  | "signed-out"
  | "ready"
  | "suspended"
  | "error";

export type Session = {
  status: SessionStatus;
  me: Me | null;
  error: string | null;
  api: ApiClient;
  loginError: string | null;
  openingGoogle: boolean;
  connectWallet: () => void;
  loginWithGoogle: () => void;
  logout: () => Promise<void>;
  retry: () => void;
  setMe: (me: Me) => void;
};

const noToken = async () => null;

const GOOGLE_LOGIN_FAILED = "Google sign-in didn't finish. Please try again.";
const GOOGLE_REDIRECT_WAIT_MS = 8000;

// Privy's standalone getter reads the live session, so one client serves the whole app.
const privyApi = createApiClient(getAccessToken);

const UNCONFIGURED: Session = {
  status: "unconfigured",
  me: null,
  error: "Login is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID in frontend/.env.local.",
  api: createApiClient(noToken),
  loginError: null,
  openingGoogle: false,
  connectWallet: () => {},
  loginWithGoogle: () => {},
  logout: async () => {},
  retry: () => {},
  setMe: () => {},
};

const SessionContext = createContext<Session>(UNCONFIGURED);

export function useSession(): Session {
  return useContext(SessionContext);
}

type Handshake = { userId: string; attempt: number } & (
  | { me: Me; error?: undefined; suspended?: undefined }
  | { me?: undefined; error: string; suspended: boolean }
);

function PrivySession({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const [attempt, setAttempt] = useState(0);
  const [handshake, setHandshake] = useState<Handshake | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const userId = authenticated ? (user?.id ?? null) : null;
  const [openingGoogle, setOpeningGoogle] = useState(false);
  const { initOAuth } = useLoginWithOAuth({
    onError: () => {
      setOpeningGoogle(false);
      setLoginError(GOOGLE_LOGIN_FAILED);
    },
  });

  const connectWallet = useCallback(() => {
    setLoginError(null);
    login({ loginMethods: ["wallet"] });
  }, [login]);

  const loginWithGoogle = useCallback(() => {
    setLoginError(null);
    setOpeningGoogle(true);
    initOAuth({ provider: "google" })
      // Success leaves the page. If that never happens, the buttons must not stay locked.
      .then(() => setTimeout(() => setOpeningGoogle(false), GOOGLE_REDIRECT_WAIT_MS))
      .catch(() => {
        setOpeningGoogle(false);
        setLoginError(GOOGLE_LOGIN_FAILED);
      });
  }, [initOAuth]);

  // POST /auth/session once per login, before anything else, then GET /me.
  useEffect(() => {
    if (!ready || !userId) return;
    let alive = true;
    privyApi
      .createSession()
      .then(() => privyApi.getMe())
      .then((me) => {
        if (alive) setHandshake({ userId, attempt, me });
      })
      .catch((err) => {
        if (alive) {
          setHandshake({
            userId,
            attempt,
            error: errorMessage(err, "Could not sign you in."),
            suspended: errorCode(err) === "ACCOUNT_SUSPENDED",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [ready, userId, attempt]);

  // A Google user's wallet is created just after login, so the first handshake can miss it.
  const clientWallet =
    user?.linkedAccounts.find(
      (account): account is WalletWithMetadata => account.type === "wallet" && account.chainType === "ethereum"
    )?.address ?? null;
  const serverWallet = handshake?.me?.user.walletAddress;
  useEffect(() => {
    if (!userId || !clientWallet || serverWallet !== null) return;
    let alive = true;
    privyApi
      .createSession()
      .then(() => privyApi.getMe())
      .then((me) => {
        if (alive) setHandshake({ userId, attempt, me });
      })
      // The next login reads the wallet again, so this can fail quietly.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, attempt, clientWallet, serverWallet]);

  const setMe = useCallback(
    (me: Me) => {
      if (userId) setHandshake({ userId, attempt, me });
    },
    [userId, attempt]
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<Session>(() => {
    const base = { api: privyApi, loginError, openingGoogle, connectWallet, loginWithGoogle, logout, retry, setMe };
    if (!ready) return { ...base, status: "loading", me: null, error: null };
    if (!userId) return { ...base, status: "signed-out", me: null, error: null };
    // Ignore results from an earlier login or attempt.
    if (!handshake || handshake.userId !== userId || handshake.attempt !== attempt) {
      return { ...base, status: "loading", me: null, error: null };
    }
    if (handshake.me) return { ...base, status: "ready", me: handshake.me, error: null };
    return {
      ...base,
      status: handshake.suspended ? "suspended" : "error",
      me: null,
      error: handshake.error ?? null,
    };
  }, [loginError, openingGoogle, connectWallet, loginWithGoogle, logout, retry, setMe, ready, userId, handshake, attempt]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // Without an app id Privy cannot initialize. Screens get an "unconfigured"
  // session and say so, instead of pretending to be signed in.
  if (!PRIVY_APP_ID) {
    return <SessionContext.Provider value={UNCONFIGURED}>{children}</SessionContext.Provider>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // The connect screen has one button for each method.
        loginMethods: ["wallet", "google"],
        appearance: {
          theme: "light",
          accentColor: "#315FE8",
          walletChainType: "ethereum-only",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <PrivySession>{children}</PrivySession>
    </PrivyProvider>
  );
}
