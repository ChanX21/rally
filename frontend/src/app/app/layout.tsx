import { Suspense } from "react";
import AppGate from "@/components/AppGate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Suspense is required by useSearchParams, which carries rally and match ids.
  return (
    <Suspense>
      <AppGate>{children}</AppGate>
    </Suspense>
  );
}
