import { inject } from 'vitest';

import { type Env, parseEnv } from '../../src/config/env.js';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: inject('databaseUrl'),
    CORS_ORIGINS: 'https://app.rally.test',
    ARC_REF_SECRET: 'test-only-reference-secret-32-chars-long',
    ...overrides,
  });
}

/** A PostgreSQL URL that refuses connections, for failure-path tests. */
export const UNREACHABLE_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:1/none';
