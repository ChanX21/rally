import type { Database } from '../db/client.js';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Either the pool or an open transaction, so repositories can join a caller's transaction. */
export type Db = Database | Tx;
