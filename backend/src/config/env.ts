import { createPublicKey } from 'node:crypto';

import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const verificationKey = z.string().refine((value) => {
  try {
    const key = createPublicKey(value);
    return value.trim().startsWith('-----BEGIN PUBLIC KEY-----')
      && key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch { return false; }
}, 'must be an ES256 SPKI PEM public key; leave blank to fetch the app key from Privy');

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte hex key');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be an EVM address');
const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

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

    WORKERS_ENABLED: booleanString.default(true),
    OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(1000),
    SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
    ADMIN_API_TOKEN: z.string().min(32).optional(),

    EVENT_ZONES: csv.default(['venue-floor-1', 'venue-floor-2', 'venue-nearby']),
    // Intent start times must fall before this. Unset means no later than MAX_DAYS_AHEAD.
    EVENT_END: z.iso.datetime({ offset: true }).optional(),
    EVENT_TIME_ZONE: z.string().min(1).default('Asia/Kolkata'),
    OFFER_HOLD_MINUTES: z.coerce.number().int().min(1).default(30),

    PRIVY_APP_ID: z.string().min(1).optional(),
    PRIVY_APP_SECRET: z.string().min(1).optional(),
    PRIVY_VERIFICATION_KEY: verificationKey.optional(),


    ARKIV_PRIVATE_KEY: privateKey.optional(),
    ARKIV_ACCESS_KEY: z.string().min(1).optional(),
    ARKIV_RPC_URL: z.url().optional(),
    ARKIV_APP: z.string().min(1).max(64).default('rally-mumbai'),
    ARKIV_EVENT: z.string().min(1).max(64).default('ethglobal-mumbai-2026'),
    ARKIV_SCHEMA_NAME: z.string().min(1).max(100).default('rally-mumbai.activity.v1'),
    // The team described 40 as the maximum; SDK 1.0.1 documents 100. 40 is valid under both.
    ARKIV_QUERY_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(40),
    ARKIV_QUERY_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),

    REWARDS_CLAIMS_ENABLED: booleanString.default(false),
    REWARD_SIGNER_PRIVATE_KEY: privateKey.optional(),
    REWARD_CLAIM_CONTRACT: address.optional(),
    REWARD_CHAIN_ID: z.coerce.number().int().positive().optional(),
    REWARD_TOKEN_UNITS_PER_POINT: z.coerce.bigint().positive().optional(),
    REWARD_VOUCHER_TTL_MINUTES: z.coerce.number().int().min(1).default(60),
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
    if (env.NODE_ENV === 'production') {
      for (const name of ['PRIVY_APP_ID', 'PRIVY_APP_SECRET'] as const) {
        if (!env[name]) {
          ctx.addIssue({ code: 'custom', path: [name], message: 'is required in production' });
        }
      }
    }
    if (Boolean(env.PRIVY_APP_ID) !== Boolean(env.PRIVY_APP_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PRIVY_APP_SECRET'],
        message: 'PRIVY_APP_ID and PRIVY_APP_SECRET must be set together',
      });
    }
    if (env.REWARDS_CLAIMS_ENABLED) {
      for (const name of [
        'REWARD_SIGNER_PRIVATE_KEY',
        'REWARD_CLAIM_CONTRACT',
        'REWARD_CHAIN_ID',
        'REWARD_TOKEN_UNITS_PER_POINT',
      ] as const) {
        if (env[name] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: 'is required when REWARDS_CLAIMS_ENABLED=true',
          });
        }
      }
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
