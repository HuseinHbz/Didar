import { envPrimitives, parseEnv } from '@iecp/validation';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: envPrimitives.nodeEnv.default('development'),
  DATABASE_URL: envPrimitives.nonEmptyString,
  REDIS_URL: envPrimitives.url.default('redis://localhost:6379'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(envSchema, source);
}
