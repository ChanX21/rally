import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const corsOrigins = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .refine((origins) => origins.every(isExactOrigin), {
    message: 'must be a comma-separated list of exact origins, e.g. https://app.example.com',
  });

export const inferenceEnvSchema = z.object({
  ZERO_G_API_KEY: z.string().min(1).optional(),
  ZERO_G_MODEL: z.string().min(1).optional(),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(8192).default(4096),
  AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(60000),
});
export type InferenceEnv = z.infer<typeof inferenceEnvSchema>;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    ...inferenceEnvSchema.shape,
    AI_REQUIRED: booleanString.default(false),
    DATABASE_URL: postgresUrl,
    DATABASE_MIGRATION_URL: postgresUrl.optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    CORS_ORIGINS: corsOrigins,
    TRUST_PROXY: booleanString.default(false),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
  })
  .superRefine((env, ctx) => {
    if (env.AI_REQUIRED && (!env.ZERO_G_API_KEY || !env.ZERO_G_MODEL)) {
      ctx.addIssue({ code: 'custom', path: ['AI_REQUIRED'], message: 'requires ZERO_G_API_KEY and ZERO_G_MODEL' });
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'must list at least one origin in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';
}

function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

/**
 * Validates configuration. Blank values count as unset so a copied .env.example
 * behaves like the defaults. Error messages name variables, never their values.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );

  const result = envSchema.safeParse(present);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new EnvValidationError(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

/** Loads .env when present. Variables already set in the process take precedence. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function loadEnv(): Env {
  loadDotEnv();
  return parseEnv(process.env);
}
