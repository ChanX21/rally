import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

import { type App, buildApp } from '../../src/app.js';
import { processOutboxBatch } from '../../src/workers/outbox.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { testEnv } from './env.js';
import { fakeAuth, FakeArkiv, FakeInfer } from './fakes.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface TestUser {
  did: string;
  id: string;
  request(method: Method, url: string, payload?: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
  get<T = Json>(url: string): Promise<T>;
  post<T = Json>(url: string, payload?: unknown, headers?: Record<string, string>): Promise<T>;
  patch<T = Json>(url: string, payload?: unknown): Promise<T>;
}

// Responses are loosely typed on purpose; schemas are enforced by the server under test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

export interface Harness {
  app: App;
  database: TestDatabase;
  ai: FakeInfer;
  arkiv: FakeArkiv;
  wallets: Record<string, string>;
  user(did: string): Promise<TestUser>;
  onboarded(did: string, overrides?: Record<string, unknown>): Promise<TestUser>;
  rally(creator: TestUser, overrides?: Record<string, unknown>): Promise<Json>;
  drainOutbox(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(envOverrides: Record<string, string> = {}): Promise<Harness> {
  const database = await createTestDatabase();
  const ai = new FakeInfer();
  const arkiv = new FakeArkiv();
  const wallets: Record<string, string> = {};
  const app = await buildApp({
    env: testEnv({ DATABASE_URL: database.url, RATE_LIMIT_MAX: '100000', ...envOverrides }),
    integrations: { auth: fakeAuth(wallets), infer: ai.infer, arkiv },
  });
  await app.ready();

  const client = (did: string, id: string): TestUser => {
    const request: TestUser['request'] = (method, url, payload, headers = {}) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer valid:${did}`, ...headers },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
    const unwrap = async (response: LightMyRequestResponse) => {
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{ data: Json }>().data;
    };
    return {
      did,
      id,
      request,
      get: async (url) => unwrap(await request('GET', url)),
      post: async (url, payload, headers) => unwrap(await request('POST', url, payload ?? {}, headers)),
      patch: async (url, payload) => unwrap(await request('PATCH', url, payload)),
    };
  };

  const harness: Harness = {
    app,
    database,
    ai,
    arkiv,
    wallets,
    async user(did) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: { authorization: `Bearer valid:${did}` },
      });
      expect(response.statusCode, response.body).toBe(200);
      return client(did, response.json<{ data: { id: string } }>().data.id);
    },
    async onboarded(did, overrides = {}) {
      const user = await harness.user(did);
      await user.post('/onboarding/complete', {
        displayName: did,
        interests: ['food', 'coffee', 'gaming'],
        optInMatching: true,
        availableFrom: hoursFromNow(-1),
        availableTo: hoursFromNow(24),
        ...overrides,
      });
      await harness.drainOutbox();
      return user;
    },
    rally(creator, overrides = {}) {
      return creator.post('/rallies', {
        category: 'food',
        goal: 'Late snack run',
        windowStart: hoursFromNow(1),
        windowEnd: hoursFromNow(3),
        durationMin: 45,
        zone: 'venue-nearby',
        groupMin: 2,
        capacity: 3,
        publish: true,
        ...overrides,
      });
    },
    async drainOutbox() {
      while ((await processOutboxBatch(app.deps)) > 0) {
        /* keep going until nothing is due */
      }
    },
    async close() {
      await app.close();
      await database.drop();
    },
  };
  return harness;
}
