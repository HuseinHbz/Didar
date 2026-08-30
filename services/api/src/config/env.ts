import { envPrimitives, parseEnv } from '@iecp/validation';
import { z } from 'zod';

/** Shared validator for every AES-256-GCM key slot (`ENCRYPTION_KEY` and
 * its `_V1`.."_V3"` rotation siblings — see the rotation comment on
 * `ENCRYPTION_KEY` below) — base64, must decode to exactly 32 bytes. */
function base64EncryptionKey(varName: string) {
  return envPrimitives.nonEmptyString.refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    },
    { message: `${varName} must be base64 and decode to exactly 32 bytes` },
  );
}

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
  // This is key version 0 — always present, always the fallback decrypt
  // target for every ciphertext written before rotation was ever
  // configured (see EncryptionService's own doc comment).
  ENCRYPTION_KEY: base64EncryptionKey('ENCRYPTION_KEY'),
  // CP-028 (P2-7) — key-rotation slots. Optional: unset means "no rotation
  // configured," the exact pre-CP-028 behavior (encrypt/decrypt both use
  // ENCRYPTION_KEY alone, ciphertext format unchanged). To rotate: set the
  // next unused ENCRYPTION_KEY_V{n} to a fresh key, then bump
  // ENCRYPTION_KEY_CURRENT_VERSION to {n} — every already-encrypted value
  // (any version, including the original unversioned/v0 ones) keeps
  // decrypting exactly as before; only *new* encryptions switch to the new
  // key. This is the rotation mechanism itself, not a KMS integration —
  // see EncryptionService's own doc comment for what's still deferred.
  ENCRYPTION_KEY_V1: base64EncryptionKey('ENCRYPTION_KEY_V1').optional(),
  ENCRYPTION_KEY_V2: base64EncryptionKey('ENCRYPTION_KEY_V2').optional(),
  ENCRYPTION_KEY_V3: base64EncryptionKey('ENCRYPTION_KEY_V3').optional(),
  ENCRYPTION_KEY_CURRENT_VERSION: z.coerce.number().int().min(0).max(3).default(0),

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
