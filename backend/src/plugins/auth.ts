import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { AppError } from '../lib/errors.js';
import { findUserByDid, type User } from '../repositories/users.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Pre-handler: a verified token mapped to an existing active user. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Pre-handler for internal routes. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    verifyBearer: (request: FastifyRequest) => Promise<string>;
  }
  interface FastifyRequest {
    user: User | null;
  }
}

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (!match?.[1]) throw new AppError(401, 'UNAUTHENTICATED', 'A bearer token is required');
  return match[1];
}

export function requireUser(request: FastifyRequest): User {
  if (!request.user) throw new AppError(401, 'UNAUTHENTICATED', 'A valid session is required');
  return request.user;
}

export const authPlugin = fp(
  (app, _options, done) => {
    app.decorateRequest('user', null);

    app.decorate('verifyBearer', async (request: FastifyRequest) => {
      const verifier = app.deps.auth;
      if (!verifier) {
        throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured');
      }
      const token = bearerToken(request);
      try {
        return (await verifier.verify(token)).did;
      } catch (cause) {
        throw new AppError(401, 'INVALID_TOKEN', 'The access token is invalid or expired', {
          cause,
        });
      }
    });

    app.decorate('authenticate', async (request: FastifyRequest) => {
      const did = await app.verifyBearer(request);
      const user = await findUserByDid(app.deps.db, did);
      if (!user) {
        throw new AppError(401, 'SESSION_REQUIRED', 'Call POST /auth/session first');
      }
      if (user.status !== 'active') {
        throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended');
      }
      request.user = user;
    });

    app.decorate('requireAdmin', async (request: FastifyRequest) => {
      const expected = app.deps.env.ADMIN_API_TOKEN;
      // Hidden entirely when no token is configured.
      if (!expected) throw new AppError(404, 'NOT_FOUND', 'Not found');
      const given = Buffer.from(bearerToken(request));
      const wanted = Buffer.from(expected);
      if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Invalid admin token');
      }
    });

    done();
  },
  { dependencies: ['integrations'], name: 'auth' },
);
