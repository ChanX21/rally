import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AiProviderError, createZeroGProvider } from '../src/integrations/zerog/index.js';

let server: Server;
let url: string;
let reply: { status: number; body: unknown; delayMs?: number };
let received: { headers: IncomingHttpHeaders; body: Record<string, unknown> } | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += String(chunk)));
    req.on('end', () => {
      received = { headers: req.headers, body: JSON.parse(body) as Record<string, unknown> };
      setTimeout(() => {
        res.statusCode = reply.status;
        res.setHeader('content-type', 'application/json');
        res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  received = undefined;
});

const provider = (overrides: Partial<Parameters<typeof createZeroGProvider>[0]> = {}) =>
  createZeroGProvider({
    apiKey: 'test-key',
    baseUrl: url,
    model: '0gm-1.0-35b-a3b',
    trustMode: undefined,
    verifyTee: false,
    timeoutMs: 2000,
    ...overrides,
  });

const request = { messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 100 };

const documented = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  model: '0gm-1.0-35b-a3b',
  choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }],
  usage: { prompt_tokens: 12, completion_tokens: 7 },
  x_0g_trace: {
    request_id: 'req_abc123',
    provider: '0xProviderAddress',
    billing: {
      currency: 'usd',
      input_cost: '1',
      output_cost: '2',
      total_cost: '3',
      total_cost_usd_micro: '3',
    },
  },
};

describe('0G provider, using the response shape seen live', () => {
  it('sends an OpenAI-format request without response_format, which the Router rejects', async () => {
    reply = { status: 200, body: documented };
    await provider().complete(request);
    expect(received?.headers.authorization).toBe('Bearer test-key');
    expect(received?.headers['x-0g-provider-trust-mode']).toBeUndefined();
    expect(received?.body).toMatchObject({
      model: '0gm-1.0-35b-a3b',
      max_tokens: 100,
    });
    expect(received?.body.response_format).toBeUndefined();
    expect(received?.body.verify_tee).toBeUndefined();
  });

  it('reads the trace into the result', async () => {
    reply = { status: 200, body: documented };
    await expect(provider().complete(request)).resolves.toEqual({
      content: '{"ok":true}',
      model: '0gm-1.0-35b-a3b',
      requestId: 'req_abc123',
      provider: '0xProviderAddress',
      promptTokens: 12,
      completionTokens: 7,
      cost: '3 usd_micro',
      teeVerified: null,
    });
  });

  it('asks for private routing and attestation only when configured', async () => {
    reply = {
      status: 200,
      body: { ...documented, x_0g_trace: { ...documented.x_0g_trace, tee_verified: true } },
    };
    const result = await provider({ trustMode: 'private', verifyTee: true }).complete(request);
    expect(received?.headers['x-0g-provider-trust-mode']).toBe('private');
    expect(received?.body.verify_tee).toBe(true);
    expect(result.teeVerified).toBe(true);
  });

  it.each([
    [429, 'rate_limit_exceeded'],
    [402, 'insufficient_balance'],
    [502, 'provider_error'],
    [503, 'no_available_provider'],
  ])('reports HTTP %i as an upstream error, keeping the request ID', async (status, code) => {
    reply = {
      status,
      body: { error: { code, message: 'secret upstream detail' }, request_id: 'req_err' },
    };
    const error = await provider().complete(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ kind: 'upstream_error', requestId: 'req_err' });
    expect((error as Error).message).toContain(code);
    expect((error as Error).message).not.toContain('secret upstream');
  });

  it('times out', async () => {
    reply = { status: 200, body: documented, delayMs: 500 };
    await expect(provider({ timeoutMs: 50 }).complete(request)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('handles a connection failure', async () => {
    await expect(
      provider({ baseUrl: 'http://127.0.0.1:1/v1' }).complete(request),
    ).rejects.toMatchObject({ kind: 'upstream_error' });
  });

  it('handles non-JSON and empty responses', async () => {
    reply = { status: 200, body: 'not json' };
    await expect(provider().complete(request)).rejects.toMatchObject({ kind: 'upstream_error' });
    reply = { status: 200, body: { choices: [{ message: { content: null } }] } };
    await expect(provider().complete(request)).rejects.toMatchObject({ kind: 'upstream_error' });
  });
});
