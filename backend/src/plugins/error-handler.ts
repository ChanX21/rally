import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

import { AppError, postgresCode, UNIQUE_VIOLATION } from '../lib/errors.js';
import type { ErrorResponse } from '../schemas/common.js';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

function describeError(error: unknown): ErrorBody {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  // Database safety nets. Services check first, so these mean a request lost a race.
  const pgCode = postgresCode(error);
  if (pgCode === UNIQUE_VIOLATION) {
    return { statusCode: 409, code: 'CONFLICT', message: 'That change conflicts with another' };
  }
  if (pgCode === '40001' || pgCode === '40P01') {
    return { statusCode: 409, code: 'RETRY', message: 'Please try again' };
  }

  const fastifyError = error as FastifyError;
  if (hasZodFastifySchemaValidationErrors(fastifyError)) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: fastifyError.validation.map((issue) => ({
        location: fastifyError.validationContext,
        path: issue.instancePath,
        message: issue.message,
      })),
    };
  }

  // Framework client errors (bad JSON, oversized body, rate limit) have safe messages.
  const { statusCode } = fastifyError;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return {
      statusCode,
      code: CLIENT_ERROR_CODES[statusCode] ?? 'BAD_REQUEST',
      message: fastifyError.message,
    };
  }

  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

function send(reply: FastifyReply, request: FastifyRequest, body: ErrorBody) {
  const response: ErrorResponse = {
    success: false,
    error: {
      code: body.code,
      message: body.message,
      ...(body.details === undefined ? {} : { details: body.details }),
      requestId: request.id,
    },
  };
  return reply.status(body.statusCode).send(response);
}

/** Every failure leaves the API in the same envelope. Unexpected errors never leak detail. */
export const errorHandlerPlugin = fp((app, _options, done) => {
  app.setErrorHandler((error, request, reply) => {
    const body = describeError(error);
    if (body.statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.info({ code: body.code, statusCode: body.statusCode }, 'request rejected');
    }
    return send(reply, request, body);
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, request, {
      statusCode: 404,
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url.split('?')[0]} not found`,
    }),
  );

  done();
});
