export const CREATE_RALLY_PATH = "/app/create-rally";
const CREATE_INTENT_KEY = "rally:create-intent";

export function rememberRallyCreation(): void {
  try { window.sessionStorage.setItem(CREATE_INTENT_KEY, "1"); } catch { /* Sign-in still works when storage is unavailable. */ }
}

export function clearRallyCreation(): void {
  try { window.sessionStorage.removeItem(CREATE_INTENT_KEY); } catch { /* Storage is optional. */ }
}

export function afterSignInPath(onboarded: boolean): string {
  if (!onboarded) return "/app/about-you";
  try {
    if (window.sessionStorage.getItem(CREATE_INTENT_KEY)) return CREATE_RALLY_PATH;
  } catch { /* Use the normal home route without storage. */ }
  return "/app/home";
}
