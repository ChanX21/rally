// Client for the Rally backend. Contract: backend/FRONTEND_HANDOFF.md.
// Every response is a { success, data } / { success, error } envelope, so we
// branch on `success`, not the HTTP status.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3123";

const DEFAULT_TIMEOUT_MS = 20_000;
// /intents/parse, /intents/:id/answers and /onboarding/questions call 0G and
// took up to 24s in live tests. The handoff asks for client timeouts above 60s.
const AI_TIMEOUT_MS = 90_000;

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
  details?: unknown;
  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = "RallyApiError";
    this.code = error.code;
    this.requestId = error.requestId;
    this.status = status;
    this.details = error.details;
  }
}

type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

type RequestOptions = {
  token?: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

async function request<T>(
  path: string,
  { token, method = "GET", body, headers: extra, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;

  // The backend rejects an empty body sent with a JSON content-type (400).
  // Only set the header when we actually have a body to send.
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new RallyApiError(0, {
      code: timedOut ? "TIMEOUT" : "NETWORK",
      message: timedOut
        ? "Rally took too long to answer. Please try again."
        : "Can't reach Rally right now. Check your connection and try again.",
    });
  }

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

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/* ---------- Types (mirror backend/src/schemas/api.ts) ---------- */

export type User = {
  id: string;
  walletAddress: string | null;
  displayName: string | null;
  optInMatching: boolean;
  onboarded: boolean;
};

export type Profile = {
  version: number;
  interests: string[];
  interestsVersion: number;
  declaredSkills: string[];
  evidence: { type: "vouch"; rallyId: string; contribution: string; at: string }[];
  preferences: Record<string, string>;
  availableFrom: string | null;
  availableTo: string | null;
  lastUpdatedAt: string;
};

export type Me = { user: User; profile: Profile | null };

export type Question = { id: string; text: string; options?: { value: string; label: string }[] };
export type OnboardingQuestion = Question;
export type Answer = { questionId: string; answer: string };

export type OnboardingQuestions = {
  questions: Question[];
  // "ai" when 0G composed them, "fallback" when the backend used templates.
  source: "ai" | "fallback";
  aiRequestId: string | null;
};

export type CompleteOnboardingInput = {
  interests: string[];
  optInMatching: boolean;
  displayName?: string;
  answers?: Answer[];
  declaredSkills?: string[];
  preferences?: Record<string, string>;
  // ISO 8601 with offset. Required by the backend when optInMatching is true.
  availableFrom?: string;
  availableTo?: string;
};

export type ProfileUpdate = {
  expectedProfileVersion?: number;
  displayName?: string;
  interests?: string[];
  declaredSkills?: string[];
  preferences?: Record<string, string>;
  availableFrom?: string | null;
  availableTo?: string | null;
  optInMatching?: boolean;
};

export type Intent = {
  preferences: Record<string, string>;
  id: string;
  status: string;
  source: "ai" | "fallback";
  category: string | null;
  goal: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  durationMin: number | null;
  groupMin: number | null;
  groupMax: number | null;
  zone: string | null;
  vibe: string | null;
  questions: Question[];
  expiresAt: string | null;
  createdAt: string;
};

export type ParsedIntent = {
  intent: Intent;
  status: "ready" | "needs_answers" | "needs_review";
  needsReview: boolean;
  aiRequestId: string | null;
};

export type ActivateIntentInput = {
  preferences?: Record<string, string>;
  category?: string;
  windowStart?: string;
  windowEnd?: string;
  durationMin?: number;
  zone?: string | null;
  vibe?: string;
  expiresAt?: string;
};

export type RallyStatus =
  | "draft"
  | "open"
  | "waiting"
  | "proposed"
  | "ready"
  | "formed"
  | "met"
  | "completed"
  | "cancelled"
  | "expired";

export type Rally = {
  matchingProgress?: { identified: number; accepted: number };
  proofFlow: boolean;
  completedAt: string | null;
  id: string;
  opaqueId: string;
  creatorId: string;
  status: RallyStatus;
  visibility: "public_coarse" | "private";
  category: string;
  goal: string;
  vibe: string | null;
  windowStart: string;
  windowEnd: string;
  meetAt: string;
  durationMin: number;
  zone: string;
  groupMin: number;
  capacity: number;
  openSeats: number;
  expiresAt: string;
  version: number;
  hasMeetingPoint: boolean;
  createdAt: string;
};

export type CreateRallyInput = {
  preferences?: Record<string, string>;
  intentId?: string;
  category: string;
  goal: string;
  vibe?: string;
  windowStart: string;
  windowEnd: string;
  durationMin: number;
  zone: string;
  groupMin: number;
  capacity: number;
  visibility?: "public_coarse" | "private";
  meetingPoint?: string;
  meetingBrief?: string;
  publish: boolean;
};

export type UpdateRallyInput = {
  expectedVersion: number;
  goal?: string;
  vibe?: string;
  windowStart?: string;
  windowEnd?: string;
  durationMin?: number;
  zone?: string;
  groupMin?: number;
  capacity?: number;
  meetingPoint?: string;
  meetingBrief?: string;
  meetAt?: string;
};

export type Member = {
  userId: string;
  displayName: string | null;
  role: string;
  checkedIn: boolean;
  arrived: boolean;
};

export type Room = {
  proofFlow: boolean;
  completedAt: string | null;
  rallyId: string;
  status: RallyStatus;
  goal: string;
  windowStart: string;
  windowEnd: string;
  meetAt: string;
  zone: string;
  meetingPoint: string | null;
  meetingBrief: string | null;
  members: Member[];
};

export type RallyProof = {
  id: string | null;
  state: "not_submitted" | "processing" | "accepted" | "needs_clearer_photos" | "unavailable";
  reason: string | null;
  canSubmit: boolean;
  rewardAmount: number;
  rewardedCount: number;
  submissionsLeft: number;
  closesAt: string;
};

export type FeedbackInput = {
  happened: boolean;
  useful?: boolean;
  vouches?: { recipientId: string; contribution: string }[];
  encoreWith?: string[];
};

export type FeedbackResult = {
  rallyStatus: RallyStatus;
  vouches: { recipientId: string; verification: string }[];
};

export type Match = {
  id: string;
  status: string;
  role: string;
  holdUntil: string;
  reason: string;
  source: "ai" | "deterministic";
  rally: Pick<
    Rally,
    | "id"
    | "status"
    | "category"
    | "goal"
    | "vibe"
    | "windowStart"
    | "windowEnd"
    | "durationMin"
    | "zone"
    | "groupMin"
    | "capacity"
    | "openSeats"
  >;
};

export type WaitingIntent = {
  id: string;
  category: string | null;
  goal: string | null;
  expiresAt: string | null;
};

export type Matches = { matches: Match[]; waiting: WaitingIntent[] };

export type PreviewActivity = {
  opaqueId: string;
  category: string;
  zone: string;
  startBucket: string;
  neededRole: string;
  minGroupSize: number;
  openSeats: number;
  status: string;
};

export type Preview = {
  available: boolean;
  notice: string | null;
  activities: PreviewActivity[];
  nextCursor: string | null;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
  readAt: string | null;
  createdAt: string;
};

export type Notifications = {
  items: Notification[];
  nextCursor: string | null;
  unreadCount: number;
};

export type RewardEntry = {
  id: string;
  rallyId: string | null;
  reason: string;
  action: string | null;
  points: number;
  policyVersion: number;
  state: "pending" | "held" | "applied" | "cancelled";
  appliesAt: string | null;
  chainTxHash: string | null;
  createdAt: string;
};

export type Rewards = {
  balance: number;
  net: number;
  tier: "Rebuilding" | "New" | "Reliable" | "Trusted";
  // Null while on-chain records are switched off.
  chain: {
    chainId: number;
    rpcUrl: string | null;
    tokenAddress: string;
    explorerUrl: string;
    address: string | null;
  } | null;
  entries: RewardEntry[];
};

export type DisputeCategory = "no_show_appeal" | "misconduct" | "false_checkin" | "other";
export type DisputeStatus = "open" | "upheld" | "dismissed" | "false";

export type RaiseDisputeInput = {
  category: DisputeCategory;
  subjectId?: string;
  description?: string;
};

export type AdminDispute = {
  id: string;
  rallyId: string;
  rallyGoal: string;
  category: DisputeCategory;
  description: string;
  status: DisputeStatus;
  raiser: { id: string; displayName: string | null; wallet: string | null };
  subject: { id: string; displayName: string | null; wallet: string | null };
  resolvedBy: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  chainStatus: "pending" | "queued" | "synced" | "failed";
  chainTxHash: string | null;
  createdAt: string;
};

export type RewardPolicy = { version: number; amounts: Record<string, number> };

export type Page<T> = { items: T[]; nextCursor: string | null };

/* ---------- Public routes ---------- */

export function getPreview(
  params: { category?: string; zone?: string; limit?: number; cursor?: string } = {}
): Promise<Preview> {
  return request<Preview>(`/activities/preview${query(params)}`);
}

/* ---------- Authenticated routes ---------- */

export type TokenSource = () => Promise<string | null>;

// Builds the authenticated client. Tokens expire after about an hour, so one is
// fetched per request rather than stored.
export function createApiClient(getToken: TokenSource) {
  async function authed<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = await getToken();
    if (!token) {
      throw new RallyApiError(401, {
        code: "SIGNED_OUT",
        message: "Please sign in again to continue.",
      });
    }
    return request<T>(path, { ...options, token });
  }

  // Handoff recovery rules: refresh the token once on INVALID_TOKEN, and create
  // the session then retry once on SESSION_REQUIRED. The backend rejects both
  // before doing any work, so retrying a command here is safe.
  async function call<T>(path: string, options: RequestOptions = {}): Promise<T> {
    try {
      return await authed<T>(path, options);
    } catch (err) {
      if (err instanceof RallyApiError && err.code === "SESSION_REQUIRED") {
        await authed("/auth/session", { method: "POST" });
        return authed<T>(path, options);
      }
      if (err instanceof RallyApiError && err.code === "INVALID_TOKEN") {
        return authed<T>(path, options);
      }
      throw err;
    }
  }

  return {
    // Call once after every login, before any other authenticated route.
    createSession: () => call<User>("/auth/session", { method: "POST" }),
    getMe: () => call<Me>("/me"),
    updateProfile: (input: ProfileUpdate) =>
      call<Me>("/me/profile", { method: "PATCH", body: input }),

    getOnboardingQuestions: (interests: string[]) =>
      call<OnboardingQuestions>("/onboarding/questions", {
        method: "POST",
        body: { interests },
        timeoutMs: AI_TIMEOUT_MS,
      }),
    // Finishes onboarding and, if opted in, starts background matching.
    completeOnboarding: (input: CompleteOnboardingInput) =>
      call<Me>("/onboarding/complete", { method: "POST", body: input }),

    parseIntent: (text: string, timeZone?: string) =>
      call<ParsedIntent>("/intents/parse", {
        method: "POST",
        body: { text, timeZone },
        timeoutMs: AI_TIMEOUT_MS,
      }),
    // Allowed once per intent. A second attempt returns 409 PARSE_BUDGET_EXHAUSTED.
    answerIntent: (id: string, answers: Answer[]) =>
      call<ParsedIntent>(`/intents/${id}/answers`, {
        method: "POST",
        body: { answers },
        timeoutMs: AI_TIMEOUT_MS,
      }),
    activateIntent: (id: string, input: ActivateIntentInput) =>
      call<Intent>(`/intents/${id}/activate`, { method: "POST", body: input }),
    cancelIntent: (id: string) => call<Intent>(`/intents/${id}/cancel`, { method: "POST" }),

    // Reuse one idempotencyKey per form, so a flaky network cannot create two rallies.
    createRally: (input: CreateRallyInput, idempotencyKey: string) =>
      call<Rally>("/rallies", {
        method: "POST",
        body: input,
        headers: { "Idempotency-Key": idempotencyKey },
      }),
    listRallies: (params: { status?: RallyStatus; limit?: number; cursor?: string } = {}) =>
      call<Page<Rally>>(`/rallies${query(params)}`),
    getRally: (id: string) => call<Rally>(`/rallies/${id}`),
    updateRally: (id: string, input: UpdateRallyInput) =>
      call<Rally>(`/rallies/${id}`, { method: "PATCH", body: input }),
    publishRally: (id: string) => call<Rally>(`/rallies/${id}/publish`, { method: "POST" }),
    cancelRally: (id: string) => call<Rally>(`/rallies/${id}/cancel`, { method: "POST" }),
    withdrawFromRally: (id: string) => call<Rally>(`/rallies/${id}/withdraw`, { method: "POST" }),
    getProof: (id: string) => call<RallyProof>(`/rallies/${id}/proof`),
    submitProof: (id: string, input: { images: string[]; note: string }, key: string) =>
      call<RallyProof>(`/rallies/${id}/proof`, { method: "POST", body: input, headers: { "Idempotency-Key": key }, timeoutMs: AI_TIMEOUT_MS }),
    getRoom: (id: string) => call<Room>(`/rallies/${id}/room`),
    markArrived: (id: string) =>
      call<{ arrivedAt: string; meetAt: string }>(`/rallies/${id}/arrive`, { method: "POST" }),
    raiseDispute: (id: string, input: RaiseDisputeInput) =>
      call<{ id: string; status: string }>(`/rallies/${id}/disputes`, { method: "POST", body: input }),
    checkIn: (id: string, presentUserIds: string[]) =>
      call<Rally>(`/rallies/${id}/check-in`, { method: "POST", body: { presentUserIds } }),
    submitFeedback: (id: string, input: FeedbackInput) =>
      call<FeedbackResult>(`/rallies/${id}/feedback`, { method: "POST", body: input }),

    listMatches: () => call<Matches>("/matches"),
    getMatch: (id: string) => call<Match>(`/matches/${id}`),
    respondToMatch: (id: string, response: "accept" | "decline") =>
      call<Match>(`/matches/${id}/respond`, { method: "POST", body: { response } }),

    listNotifications: (params: { limit?: number; unreadOnly?: boolean; cursor?: string } = {}) =>
      call<Notifications>(`/notifications${query(params)}`),
    markNotificationRead: (id: string) =>
      call<Notification>(`/notifications/${id}/read`, { method: "POST" }),
    markAllNotificationsRead: () =>
      call<{ updated: number }>("/notifications/read-all", { method: "POST" }),

    getRewards: () => call<Rewards>("/me/rewards"),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

// Text that is safe to show. Unexpected failures carry requestId so the backend
// owner can find them in the logs.
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof RallyApiError) {
    return err.status >= 500 && err.requestId ? `${err.message} (ref ${err.requestId})` : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

export function errorCode(err: unknown): string | null {
  return err instanceof RallyApiError ? err.code : null;
}
