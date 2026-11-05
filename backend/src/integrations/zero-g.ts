import type { ReadableStreamDefaultReader } from 'node:stream/web';
import { z } from 'zod';
import type { InferenceEnv } from '../config/env.js';

export interface InferenceDiagnostics {
  reason?: 'output_limit' | 'empty_content' | 'response_shape' | 'invalid_json' | 'schema_mismatch' | 'http_error' | 'network_error';
  providerRequestId?: string; tokens?: number; httpStatus?: number;
}
export class InferenceError extends Error {
  constructor(readonly code: 'unavailable' | 'timeout' | 'invalid_output', readonly diagnostics: InferenceDiagnostics = {}) { super(code); }
}
export interface InferenceReply {
  text: string;
  model: string;
  providerRequestId?: string;
  tokens?: number;
}
export type Infer = (system: string, input: unknown) => Promise<InferenceReply>;
const responseSchema = z.object({
  id: z.string().max(200).optional(),
  choices: z.array(z.object({ finish_reason: z.string().max(64).optional(), message: z.object({ content: z.string().max(16000).nullable() }) })).min(1),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }).optional(),
});

/** 0G Router API; no wallet signing or unverified TEE claims. */
export function createZeroG(env: InferenceEnv, transport: typeof fetch = fetch): Infer {
  return async (system, input) => {
    if (!env.ZERO_G_API_KEY || !env.ZERO_G_MODEL) throw new InferenceError('unavailable');
    const signal = AbortSignal.timeout(env.AI_TIMEOUT_MS);
    try {
      const response = await transport('https://router-api.0g.ai/v1/chat/completions', {
        method: 'POST', signal, redirect: 'error',
        headers: { authorization: `Bearer ${env.ZERO_G_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.ZERO_G_MODEL, temperature: 0, max_tokens: env.AI_MAX_OUTPUT_TOKENS,
          messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new InferenceError('unavailable', { reason: 'http_error', httpStatus: response.status }); }
      if (!response.body) throw new InferenceError('invalid_output');
      const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 64000) throw new InferenceError('invalid_output');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const parsed = responseSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!parsed.success) throw new InferenceError('invalid_output', { reason: 'response_shape' });
      const choice = parsed.data.choices[0]!;
      const metadata = { providerRequestId: parsed.data.id, tokens: parsed.data.usage?.total_tokens };
      if (choice.finish_reason === 'length') throw new InferenceError('invalid_output', { ...metadata, reason: 'output_limit' });
      if (!choice.message.content?.trim()) throw new InferenceError('invalid_output', { ...metadata, reason: 'empty_content' });
      // Some providers fence otherwise valid JSON; remove only a complete JSON fence.
      const content = choice.message.content.trim();
      const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(content);
      return { text: fence?.[1] ?? content, model: env.ZERO_G_MODEL,
        providerRequestId: parsed.data.id, tokens: parsed.data.usage?.total_tokens };
    } catch (error) {
      if (error instanceof InferenceError) throw error;
      if (signal.aborted) throw new InferenceError('timeout');
      // Never retain provider messages/causes: they may contain credentials or user input.
      throw new InferenceError(error instanceof SyntaxError ? 'invalid_output' : 'unavailable', { reason: error instanceof SyntaxError ? 'invalid_json' : 'network_error' });
    }
  };
}
