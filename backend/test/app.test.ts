import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type App, buildApp } from '../src/app.js';
import { AppError } from '../src/lib/errors.js';
import { ok, successSchema } from '../src/schemas/common.js';
import { testEnv, UNREACHABLE_DATABASE_URL } from './helpers/env.js';

const probeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/test/echo',
    {
      schema: {
        body: z.object({ name: z.string().min(2) }),
        response: { 200: successSchema(z.object({ name: z.string() })) },
      },
    },
    (request) => ok({ name: request.body.name }),
  );
  app.get('/test/app-error', () => {
    throw new AppError(409, 'SEAT_TAKEN', 'That seat is gone', {
      details: { rallyId: 'rly_1' },
      cause: new Error('internal cause'),
    });
  });
  app.get('/test/crash', () => {
    throw new Error('connection string postgres://secret leaked');
  });
  app.get(
    '/test/bad-response',
    { schema: { response: { 200: successSchema(z.object({ count: z.number() })) } } },
    () => ok({ count: 'not-a-number' as unknown as number }),
  );
};

describe('app', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv() });
    await app.register(probeRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  describe('responses', () => {
    it('wraps success in the envelope', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test/echo',
        payload: { name: 'Rally' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, data: { name: 'Rally' } });
    });

    it('returns validation failures as 400 with details', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test/echo',
        payload: { name: 'x' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: [{ location: 'body', path: '/name' }],
          requestId: response.headers['x-request-id'],
        },
      });
    });

    it('returns malformed JSON as 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test/echo',
        headers: { 'content-type': 'application/json' },
        payload: '{not json',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ success: false, error: { code: 'BAD_REQUEST' } });
    });

    it('returns AppError code, message and details', async () => {
      const response = await app.inject({ url: '/test/app-error' });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: {
          code: 'SEAT_TAKEN',
          message: 'That seat is gone',
          details: { rallyId: 'rly_1' },
        },
      });
      expect(response.body).not.toContain('internal cause');
    });

    it('hides unexpected error detail', async () => {
      const response = await app.inject({ url: '/test/crash' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
      });
      expect(response.body).not.toContain('secret');
    });

    it('treats an invalid response body as a server error', async () => {
      const response = await app.inject({ url: '/test/bad-response' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
      expect(response.body).not.toContain('not-a-number');
    });

    it('returns unknown routes in the envelope', async () => {
      const response = await app.inject({ url: '/nope?token=abc' });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      expect(response.body).not.toContain('abc');
    });
  });

  describe('request IDs', () => {
    it('generates one by default', async () => {
      const response = await app.inject({ url: '/health' });
      expect(response.headers['x-request-id']).toMatch(/^[\w-]{36}$/);
    });

    it('keeps a well-formed caller ID', async () => {
      const response = await app.inject({
        url: '/health',
        headers: { 'x-request-id': 'trace-12345678' },
      });
      expect(response.headers['x-request-id']).toBe('trace-12345678');
    });

    it('replaces a malformed caller ID', async () => {
      const response = await app.inject({
        url: '/health',
        headers: { 'x-request-id': 'bad id {"injected":true}' },
      });
      expect(response.headers['x-request-id']).not.toContain('injected');
    });
  });

  describe('CORS', () => {
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/test/echo',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      });

    it('allows a listed origin', async () => {
      const response = await preflight('https://app.rally.test');
      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('https://app.rally.test');
      expect(response.headers['access-control-allow-headers']).toContain('Authorization');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('does not allow an unlisted origin', async () => {
      const response = await preflight('https://evil.test');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('sets security headers', async () => {
    const response = await app.inject({ url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('health', () => {
  it('reports ready when the database responds', async () => {
    const app = await buildApp({ env: testEnv() });
    try {
      const live = await app.inject({ url: '/health' });
      expect(live.statusCode).toBe(200);
      expect(live.json()).toMatchObject({ success: true, data: { status: 'ok' } });

      const ready = await app.inject({ url: '/health/ready' });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toEqual({
        success: true,
        data: { status: 'ready', database: 'ok' },
      });
    } finally {
      await app.close();
    }
  });

  it('stays live but reports 503 when the database is down', async () => {
    const app = await buildApp({ env: testEnv({ DATABASE_URL: UNREACHABLE_DATABASE_URL }) });
    try {
      expect((await app.inject({ url: '/health' })).statusCode).toBe(200);

      const ready = await app.inject({ url: '/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE' },
      });
      expect(ready.body).not.toContain('127.0.0.1');
    } finally {
      await app.close();
    }
  });
});

describe('rate limiting', () => {
  it('returns 429 in the envelope and exempts health checks', async () => {
    const app = await buildApp({ env: testEnv({ RATE_LIMIT_MAX: '1' }) });
    await app.register(probeRoutes);
    try {
      const hit = () =>
        app.inject({ method: 'POST', url: '/test/echo', payload: { name: 'Rally' } });
      expect((await hit()).statusCode).toBe(200);

      const limited = await hit();
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({
        success: false,
        error: { code: 'RATE_LIMITED' },
      });

      for (let i = 0; i < 3; i += 1) {
        expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
  });
});
