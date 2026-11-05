// Thin client for the Rally backend. Contract: backend/FRONTEND_HANDOFF.md.
// Every response is a { success, data } / { success, error } envelope — branch
// on `success`, not the HTTP status.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
};

export class RallyApiError extends Error {
  code: string;
  requestId?: string;
  status: number;
  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = "RallyApiError";
    this.code = error.code;
    this.requestId = error.requestId;
    this.status = status;
  }
}

type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

async function request<T>(
  path: string,
  { token, method = "GET", body }: { token?: string; method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  // The backend rejects an empty body sent with a JSON content-type (400).
  // Only set the header when we actually have a body to send.
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });

  let json: Envelope<T>;
  try {
    json = await res.json();
  } catch {
    throw new RallyApiError(res.status, {
      code: "NETWORK",
      message: `Unexpected non-JSON response (${res.status})`,
    });
  }

  if (!json.success) {
    throw new RallyApiError(res.status, json.error);
  }
  return json.data;
}

export type Me = {
  user: {
    id: string;
    walletAddress: string;
    displayName: string | null;
    optInMatching: boolean;
    onboarded: boolean;
  };
  profile: unknown | null;
};

// Call once after every login, before any other authenticated route.
export function createSession(token: string): Promise<unknown> {
  return request("/auth/session", { token, method: "POST", body: {} });
}

export function getMe(token: string): Promise<Me> {
  return request<Me>("/me", { token });
}

export type OnboardingQuestion = { id: string; text: string };

export type OnboardingQuestions = {
  questions: OnboardingQuestion[];
  // "ai" when 0G composed them, "fallback" when the backend used templates.
  source: "ai" | "fallback";
  aiRequestId: string | null;
};

// AI-composed follow-up questions for the three chosen interests. Calls 0G and
// can take 7–24s; the backend returns fallback questions if AI is unavailable.
export function getOnboardingQuestions(
  token: string,
  interests: string[]
): Promise<OnboardingQuestions> {
  return request<OnboardingQuestions>("/onboarding/questions", {
    token,
    method: "POST",
    body: { interests },
  });
}

export type CompleteOnboardingInput = {
  interests: string[];
  optInMatching: boolean;
  displayName?: string;
  answers?: { questionId: string; answer: string }[];
  declaredSkills?: string[];
  preferences?: Record<string, string>;
  // ISO 8601 with offset. Required by the backend when optInMatching is true.
  availableFrom?: string;
  availableTo?: string;
};

// Finishes onboarding and (if opted in) kicks off background matching.
// Returns the updated user (onboarded: true) and profile.
export function completeOnboarding(
  token: string,
  input: CompleteOnboardingInput
): Promise<Me> {
  return request<Me>("/onboarding/complete", { token, method: "POST", body: input });
}
