import { z } from 'zod';

/**
 * Parses `process.env` against a Zod schema and fails fast with a readable error
 * instead of letting an `undefined` env var turn into a runtime `any` somewhere deep
 * in a service. Every service's `src/config/env.ts` should be a thin wrapper around
 * this (see services/api/src/config/env.ts for the reference usage).
 */
export function parseEnv<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  source: Record<string, string | undefined> = process.env,
): z.infer<z.ZodObject<T>> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/** Common env var primitives reused across services. */
export const envPrimitives = {
  port: z.coerce.number().int().min(1).max(65535),
  nodeEnv: z.enum(['development', 'test', 'staging', 'production']),
  url: z.url(),
  nonEmptyString: z.string().min(1),
};
