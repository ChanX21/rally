import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { AppError } from '../src/lib/errors.js';
import { serializeError } from '../src/lib/logger.js';

function postgresError() {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: 'users_privy_did_unique',
    detail: 'Key (privy_did)=(did:privy:private-user) already exists.',
  });
}

describe('serializeError', () => {
  const query = new DrizzleQueryError(
    'insert into users (privy_did) values ($1)',
    ['did:privy:private-user'],
    postgresError(),
  );

  it('removes bind parameters and row values from query errors', () => {
    const serialized = serializeError(query);
    expect(JSON.stringify(serialized)).not.toContain('private-user');
    expect(serialized).toMatchObject({
      message: 'Failed query: insert into users (privy_did) values ($1)',
      cause: { code: '23505', constraint: 'users_privy_did_unique' },
    });
  });

  it('applies the same protection through a wrapping error', () => {
    const wrapped = new AppError(503, 'DATABASE_UNAVAILABLE', 'Unavailable', { cause: query });
    const serialized = serializeError(wrapped);
    expect(JSON.stringify(serialized)).not.toContain('private-user');
    expect(serialized).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
  });

  it('keeps the stack of ordinary errors', () => {
    expect(serializeError(new Error('boom')).stack).toContain('boom');
  });

  it('handles non-Error values', () => {
    expect(serializeError('boom')).toMatchObject({ type: 'string', message: 'boom' });
  });
});
