import { envPrimitives, parseEnv } from '@iecp/validation';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: envPrimitives.nodeEnv.default('development'),
  PORT: envPrimitives.port.default(4000),
  DATABASE_URL: envPrimitives.nonEmptyString,
  JWT_SECRET: envPrimitives.nonEmptyString,
  CORS_ORIGIN: envPrimitives.nonEmptyString.default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

/** Fails fast on startup if any required env var is missing/invalid (blueprint §109). */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(envSchema, source);
}
