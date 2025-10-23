import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CORS_ORIGINS: z.string().optional(),
  RPC_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().optional(),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_SSL: z
    .union([z.literal('true'), z.literal('false')])
    .optional(),
  CHAIN_ID: z.coerce.number().optional(),
  POLICY_NFT_ADDRESS: z.string().optional(),
  PAYOUT_MODULE_ADDRESS: z.string().optional(),
  RESERVE_POOL_ADDRESS: z.string().optional(),
  POLICY_DISTRIBUTOR_ADDRESS: z.string().optional(),
  ORACLE_ANCHORS_ADDRESS: z.string().optional(),
  ORACLE_SIGNER_KEY: z.string().optional(),
  QUOTE_SIGNER_KEY: z.string().optional(),
  VALIDATOR_API_BASE_URL: z.string().url().optional(),
  VALIDATOR_API_SECRET: z.string().optional(),
  VALIDATOR_API_URL: z.string().url().optional(),
  VALIDATOR_API_KEY: z.string().optional()
});

const env = EnvSchema.parse(process.env);

function parseCorsOrigins(value: string | undefined): string[] | true {
  if (!value) {
    return true;
  }

  const origins = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return origins.length > 0 ? origins : true;
}

export const appConfig = {
  ...env,
  corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
  dbSsl: env.DB_SSL ? env.DB_SSL === 'true' : undefined
};

export type AppConfig = typeof appConfig;
