// Routing after sign-in / onboarding. Rally is match-only: users are matched into
// existing rallies rather than authoring their own, so there is no plan to resume.

export function afterSignInPath(onboarded: boolean): string {
  return onboarded ? "/app/home" : "/app/about-you";
}
