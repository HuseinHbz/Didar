import { envPrimitives, parseEnv } from '@iecp/validation';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: envPrimitives.nodeEnv.default('development'),
  REDIS_URL: envPrimitives.url.default('redis://localhost:6379'),
  // CP-029 (P1-5) — this worker has no HTTP surface of its own (see
  // src/main.ts's own doc comment); the metrics server started alongside it
  // is a separate, minimal listener, matching the port
  // infrastructure/monitoring/prometheus.yml already declares for the
  // `iecp-notification-worker` scrape target.
  METRICS_PORT: envPrimitives.port.default(9090),
  // Real provider credentials land here once each adapter is wired for real —
  // see the ⚠️ Stub notes in src/notifications/adapters/*.ts.
  SMS_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(envSchema, source);
}
