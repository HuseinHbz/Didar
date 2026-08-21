import { envPrimitives, parseEnv } from '@iecp/validation';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: envPrimitives.nodeEnv.default('development'),
  REDIS_URL: envPrimitives.url.default('redis://localhost:6379'),
  // Real provider credentials land here once each adapter is wired for real —
  // see the ⚠️ Stub notes in src/notifications/adapters/*.ts.
  //
  // CP-017: SmsAdapter is real (Kavenegar) as of this phase. Unset/empty
  // SMS_API_KEY is deliberately still a valid, safe configuration — the
  // adapter falls back to the exact pre-CP-017 stub behavior (see its own
  // doc comment) rather than failing to boot, so every environment that
  // never configured a real key (local dev, CI, this sandbox — outbound
  // egress to api.kavenegar.com is proxy-denied here, confirmed the same
  // way ADR-008 confirmed it for ZarinPal) keeps working unchanged.
  SMS_API_KEY: z.string().optional(),
  // Kavenegar sender line number — optional, provider falls back to its
  // account's own default line when unset.
  SMS_SENDER: z.string().optional(),
  // Kavenegar "Lookup" template name (their Panel > Verify-Lookup feature)
  // used for OTP-purpose messages specifically — see sms.adapter.ts. Real
  // deployments register their own template text in the Kavenegar panel;
  // this is only the *name* used to reference it, never message content.
  SMS_OTP_TEMPLATE: z.string().default('verify'),
  // Overridable only for tests (sms.adapter.spec.ts points this at a real
  // local HTTP server standing in for Kavenegar's REST contract — never
  // jest.mock of fetch, see that file's own doc comment). No real
  // deployment needs to set this.
  SMS_BASE_URL: envPrimitives.url.default('https://api.kavenegar.com'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(envSchema, source);
}
