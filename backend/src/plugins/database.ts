import fp from 'fastify-plugin';

import { createDatabase, type Database } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export const databasePlugin = fp<{ url: string; poolMax: number }>((app, options, done) => {
  const { db, close } = createDatabase(options);
  app.decorate('db', db);
  // onClose runs after in-flight requests finish.
  app.addHook('onClose', () => close());
  done();
}, { name: 'database' });
