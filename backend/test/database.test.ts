import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { createDatabase } from '../src/db/client.js';
import { createTestDatabase } from './helpers/db.js';

it('keeps concurrent replies and transaction boundaries correct on one connection', async () => {
  const database = await createTestDatabase();
  const client = createDatabase({ url: database.url, poolMax: 1 });
  try {
    const results = await Promise.all(Array.from({ length: 20 }, (_, n) =>
      client.db.execute(sql`select ${n}::int as n`)));
    expect(results.map((rows) => rows[0]?.n)).toEqual(Array.from({ length: 20 }, (_, n) => n));
    const transactions = await Promise.all(Array.from({ length: 3 }, (_, n) =>
      client.db.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        return tx.execute(sql`select ${n}::int as n`);
      })));
    expect(transactions.map((rows) => rows[0]?.n)).toEqual([0, 1, 2]);
    await expect(client.db.transaction((tx) => tx.execute(sql`select 1 / 0`))).rejects.toThrow();
    expect((await client.db.execute(sql`select 42 as n`))[0]?.n).toBe(42);
  } finally {
    await client.close();
    await database.drop();
  }
});
