import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

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

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
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
    OFFER_HOLD_MINUTES: z.coerce.number().int().min(1).default(30),

    PRIVY_APP_ID: z.string().min(1).optional(),
    PRIVY_APP_SECRET: z.string().min(1).optional(),
    PRIVY_VERIFICATION_KEY: z.string().min(1).optional(),

    ZG_API_KEY: z.string().min(1).optional(),
    ZG_BASE_URL: z.url().default('https://router-api.0g.ai/v1'),
    ZG_MODEL: z.string().min(1).default('qwen3.7-flash'),
    ZG_TRUST_MODE: z.string().min(1).optional(),
    ZG_VERIFY_TEE: booleanString.default(false),
    // Live calls took 7 to 24 seconds, so much less than this would make fallbacks the norm.
    ZG_TIMEOUT_MS: z.coerce.number().int().min(500).default(45_000),

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
