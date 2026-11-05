import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/** OpenAPI is generated from route schemas, so it cannot drift from what is validated. */
export const docsPlugin = fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      info: { title: 'Rally API', version: '1.0.0' },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
});
