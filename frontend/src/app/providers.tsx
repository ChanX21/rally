"use client";

import { PrivyProvider } from "@privy-io/react-auth";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export default function Providers({ children }: { children: React.ReactNode }) {
  // Without an app id Privy cannot initialize. Render children so the static
  // mockup screens still work in dev, and surface a clear console warning.
  if (!PRIVY_APP_ID) {
    if (typeof window !== "undefined") {
      console.warn(
        "NEXT_PUBLIC_PRIVY_APP_ID is not set — Privy login is disabled. " +
          "Add it to frontend/.env.local (use the same app id as the backend)."
      );
    }
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Wallet-first login to match the connect-wallet screen.
        loginMethods: ["wallet"],
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
      {children}
    </PrivyProvider>
  );
}
