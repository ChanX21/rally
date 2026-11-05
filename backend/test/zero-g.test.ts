import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { formationPlugin } from '../src/plugins/formation.js';
import { inferenceEnvSchema, parseEnv } from '../src/config/env.js';
import { createZeroG } from '../src/integrations/zero-g.js';
const env = () => parseEnv({ DATABASE_URL: 'postgres://localhost/rally', ZERO_G_API_KEY: 'test-key', ZERO_G_MODEL: 'test-model' });
const reply = (content: string) => Response.json({ id: 'provider-1', choices: [{ message: { content } }], usage: { total_tokens: 8 } });
describe('0G Router adapter', () => {
  it('can configure inference without a database', () => {
    expect(inferenceEnvSchema.parse({ ZERO_G_API_KEY: 'key', ZERO_G_MODEL: 'model' })).toEqual({ ZERO_G_API_KEY: 'key', ZERO_G_MODEL: 'model', AI_TIMEOUT_MS: 60000, AI_MAX_OUTPUT_TOKENS: 4096 });
  });
  it('bounds the configurable inference deadline', () => {
    expect(inferenceEnvSchema.parse({ AI_TIMEOUT_MS: '90000' }).AI_TIMEOUT_MS).toBe(90000);
    expect(inferenceEnvSchema.safeParse({ AI_TIMEOUT_MS: '120001' }).success).toBe(false);
  });
  it('registers the engine on Fastify without exposing public routes', async () => {
    const app = Fastify();
    try {
      await app.register(formationPlugin, { env: parseEnv({ DATABASE_URL: 'postgres://localhost/rally' }) });
      await app.ready();
      expect(typeof app.formation.composeGroup).toBe('function');
      const response = await app.inject('/intents/parse');
      expect(response.statusCode).toBe(404);
    } finally { await app.close(); }
  });
  it('uses server-side bearer auth and preserves safe metadata', async () => {
    const transport = vi.fn<typeof fetch>(async () => reply('{"ok":true}'));
    const result = await createZeroG(env(), transport)('JSON only', { sample: true });
    expect(result).toMatchObject({ model: 'test-model', providerRequestId: 'provider-1', tokens: 8 });
    expect(transport.mock.calls[0]?.[0]).toBe('https://router-api.0g.ai/v1/chat/completions');
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer test-key' } });
  });
  it('prefers the Router trace ID, and keeps provider and cost', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({
      id: 'chatcmpl-1',
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { total_tokens: 8 },
      x_0g_trace: {
        request_id: 'router-1',
        provider: '0xprovider',
        billing: { currency: 'usd', total_cost: '20', total_cost_usd_micro: '20' },
      },
    }));
    const result = await createZeroG(env(), transport)('JSON only', {});
    expect(result).toMatchObject({ providerRequestId: 'router-1', provider: '0xprovider', cost: '20 usd_micro' });
  });
  it('never sends response_format, which the live Router rejects', async () => {
    const transport = vi.fn<typeof fetch>(async () => reply('{"ok":true}'));
    await createZeroG(env(), transport)('JSON only', {});
    expect(JSON.parse(transport.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty('response_format');
  });
  it('unwraps a complete JSON code fence without accepting surrounding prose', async () => {
    expect((await createZeroG(env(), async () => reply('```json\n{"ok":true}\n```'))('', {})).text).toBe('{"ok":true}');
    expect((await createZeroG(env(), async () => reply('Here is JSON: ```json\n{}\n```'))('', {})).text).toContain('Here is JSON');
  });
  it('is unavailable when credentials are absent', async () => {
    await expect(createZeroG(parseEnv({ DATABASE_URL: 'postgres://localhost/rally' }))('', {})).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('rejects missing credentials in required mode', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://localhost/rally', AI_REQUIRED: 'true' })).toThrow(/AI_REQUIRED/);
  });
  it.each([401, 429, 500])('sanitizes HTTP %i', async (status) => {
    await expect(createZeroG(env(), async () => new Response('secret-body', { status }))('', {})).rejects.toMatchObject({ code: 'unavailable', message: 'unavailable' });
  });
  it('sanitizes transport exceptions', async () => {
    await expect(createZeroG(env(), async () => { throw new Error('secret'); })('', {})).rejects.toMatchObject({ message: 'unavailable' });
  });
  it('rejects malformed JSON', async () => {
    await expect(createZeroG(env(), async () => new Response('{'))('', {})).rejects.toMatchObject({ code: 'invalid_output' });
  });
  it('distinguishes a reasoning/token limit from bad JSON', async () => {
    const result = { id: 'truncated', choices: [{ finish_reason: 'length', message: { content: null } }], usage: { total_tokens: 4096 } };
    await expect(createZeroG(env(), async () => Response.json(result))('', {})).rejects.toMatchObject({ code: 'invalid_output', diagnostics: { reason: 'output_limit', providerRequestId: 'truncated', tokens: 4096 } });
  });
  it('distinguishes empty content', async () => {
    await expect(createZeroG(env(), async () => reply(''))('', {})).rejects.toMatchObject({ diagnostics: { reason: 'empty_content' } });
  });
  it('caps response size', async () => {
    await expect(createZeroG(env(), async () => new Response('x'.repeat(65000)))('', {})).rejects.toMatchObject({ code: 'invalid_output' });
  });
  it('reports a timeout without retaining error details', async () => {
    const e = { ...env(), AI_TIMEOUT_MS: 100 };
    const transport: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('sensitive')), { once: true });
    });
    await expect(createZeroG(e, transport)('', {})).rejects.toMatchObject({ code: 'timeout' });
  });
});
