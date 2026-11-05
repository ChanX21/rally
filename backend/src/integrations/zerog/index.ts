export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  maxTokens: number;
}

export interface CompletionResult {
  content: string;
  model: string;
  requestId: string | null;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Amount plus unit, e.g. "29 usd_micro". Docs say neuron; live responses report micro-dollars. */
  cost: string | null;
  teeVerified: boolean | null;
}

export type AiErrorKind = 'timeout' | 'upstream_error';

export class AiProviderError extends Error {
  override readonly name = 'AiProviderError';

  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

export interface AiProvider {
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export interface ZeroGOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  trustMode: string | undefined;
  verifyTee: boolean;
  timeoutMs: number;
}

interface RouterResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  request_id?: string;
  x_0g_trace?: {
    request_id?: string;
    provider?: string;
    billing?: { total_cost?: string | number; total_cost_usd_micro?: string | number };
    tee_verified?: boolean;
  };
  error?: { code?: string; message?: string };
}

/** Client for the 0G Compute Router, which speaks the OpenAI chat completions format. */
export function createZeroGProvider(options: ZeroGOptions): AiProvider {
  const url = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    model: options.model,

    async complete(request) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
            ...(options.trustMode === undefined
              ? {}
              : { 'x-0g-provider-trust-mode': options.trustMode }),
          },
          body: JSON.stringify({
            model: options.model,
            messages: request.messages,
            max_tokens: request.maxTokens,
            temperature: 0.2,
            // No response_format. Tested live: the Router answers no_available_provider or
            // provider_error with it, even for models the catalog lists as supporting it. Prompts
            // ask for JSON, and the harness validates every reply strictly.
            ...(options.verifyTee ? { verify_tee: true } : {}),
          }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        throw new AiProviderError(
          timedOut ? 'timeout' : 'upstream_error',
          timedOut ? '0G request timed out' : '0G request failed',
        );
      }

      const body = (await response.json().catch(() => ({}))) as RouterResponse;
      const requestId = body.x_0g_trace?.request_id ?? body.request_id ?? null;

      if (!response.ok) {
        throw new AiProviderError(
          'upstream_error',
          `0G returned ${response.status}${body.error?.code ? ` (${body.error.code})` : ''}`,
          requestId,
        );
      }

      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new AiProviderError('upstream_error', '0G returned no content', requestId);
      }

      const billing = body.x_0g_trace?.billing;
      return {
        content,
        model: body.model ?? options.model,
        requestId,
        provider: body.x_0g_trace?.provider ?? null,
        promptTokens: body.usage?.prompt_tokens ?? null,
        completionTokens: body.usage?.completion_tokens ?? null,
        cost:
          billing?.total_cost_usd_micro !== undefined
            ? `${billing.total_cost_usd_micro} usd_micro`
            : billing?.total_cost !== undefined
              ? `${billing.total_cost} neuron`
              : null,
        teeVerified: body.x_0g_trace?.tee_verified ?? null,
      };
    },
  };
}
