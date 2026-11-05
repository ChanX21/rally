// The plan the user is working on, kept in sessionStorage so it survives the
// connect-wallet and onboarding steps. Raw intent text stays out of the URL.

import type { ParsedIntent } from "@/lib/api";

const KEY = "rally.plan";

export type StoredPlan = {
  text: string;
  // One key per form, reused on retries, so a flaky network cannot create two rallies.
  idempotencyKey: string;
  parsed: ParsedIntent | null;
};

function newKey(): string {
  // crypto.randomUUID only exists in secure contexts; phones testing over LAN http lack it.
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function readPlan(): StoredPlan | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredPlan) : null;
  } catch {
    return null;
  }
}

function writePlan(plan: StoredPlan): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(plan));
  } catch {
    // Private mode can refuse storage. The plan then lasts only for this screen.
  }
}

export function startPlan(text: string): void {
  writePlan({ text, idempotencyKey: newKey(), parsed: null });
}

export function saveParsed(parsed: ParsedIntent): void {
  const plan = readPlan();
  if (plan) writePlan({ ...plan, parsed });
}

export function clearPlan(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

// Where to send someone who has just signed in or finished onboarding.
export function afterSignInPath(onboarded: boolean): string {
  if (!onboarded) return "/app/about-you";
  return readPlan() ? "/app/check-plan" : "/app/home";
}
