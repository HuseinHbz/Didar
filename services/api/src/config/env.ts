import { envPrimitives, parseEnv } from '@iecp/validation';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: envPrimitives.nodeEnv.default('development'),
  PORT: envPrimitives.port.default(4000),
  DATABASE_URL: envPrimitives.nonEmptyString,
  JWT_SECRET: envPrimitives.nonEmptyString,
  // CP-018: comma-separated — the admin panel (apps/admin, :3001) is a
  // second real browser origin alongside the storefront (apps/storefront,
  // :3000), both legitimately calling this API cross-origin in local dev.
  // main.ts splits this into the array Nest's `enableCors({ origin })`
  // accepts.
  CORS_ORIGIN: envPrimitives.nonEmptyString.default('http://localhost:3000,http://localhost:3001'),

  // identity module (Phase 004) — see services/api/src/modules/identity/README.md
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000), // 30 days
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300), // 5 min
  // AES-256-GCM key for TwoFactorCredential.secretEncrypted — base64, must
  // decode to exactly 32 bytes. No default: a real environment must set its
  // own; see identity/README.md for what "real" needs beyond this env var.
  ENCRYPTION_KEY: envPrimitives.nonEmptyString.refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    },
    { message: 'ENCRYPTION_KEY must be base64 and decode to exactly 32 bytes' },
  ),

  // inventory module (Phase 006) — BullMQ connection for the
  // reservation_expiration/low_stock_notification/inventory_event_processing
  // queues, hosted in-process here rather than in services/worker (ADR-006
  // decision 8). Same default `services/worker` already uses.
  REDIS_URL: envPrimitives.url.default('redis://localhost:6379'),

  // payment module (Phase 008) — see src/modules/payment/README.md. The
  // real merchant credential per provider, namespaced by provider code,
  // never persisted to Postgres (ADR-008 decision 8; `PaymentProvider
  // .config` holds only non-secret settings). ZarinPal's sandbox
  // environment accepts any well-formed UUID as `merchant_id` and never
  // moves real money — this is ZarinPal's own publicly documented sandbox
  // test value, safe for local dev so `.env.example` boots without an
  // extra step; a real environment must set its own.
  PAYMENT_ZARINPAL_MERCHANT_ID: envPrimitives.nonEmptyString.default(
    '36fd6885-1ecf-11e8-ae1c-005056a205be',
  ),
  // Base URL this API is reachable at, used to build ZarinPal's
  // `callback_url` (where the customer's browser is redirected back to
  // after paying). Must be reachable from the customer's browser, not
  // from this server.
  PAYMENT_ZARINPAL_CALLBACK_BASE_URL: envPrimitives.url.default('http://localhost:4000'),
});

export type Env = z.infer<typeof envSchema>;

/** Fails fast on startup if any required env var is missing/invalid (blueprint §109). */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(envSchema, source);
}
