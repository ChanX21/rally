import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export interface DatabaseOptions {
  url: string;
  poolMax: number;
}

export function createDatabase({ url, poolMax }: DatabaseOptions) {
  const client = postgres(url, {
    max: poolMax,
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    // Supavisor's transaction pooler can lose replies to pipelined queries.
    max_pipeline: 1,
    connect_timeout: 5,
    idle_timeout: 20,
    onnotice: () => {},
  });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDatabase>['db'];
