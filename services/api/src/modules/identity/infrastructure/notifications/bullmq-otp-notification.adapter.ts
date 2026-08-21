import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import type { OtpPurpose } from '../../domain/entities/otp-request.entity';
import type { OtpNotificationPort } from '../../domain/ports/otp-notification.port';
import { NOTIFICATIONS_QUEUE } from '../queues/queue-names';

/** Mirrors `services/notification-worker`'s own `NotificationJobData`
 * shape exactly (that service's `queue/notification.processor.ts`) —
 * duplicated rather than shared across a process boundary, matching this
 * repo's existing per-service duplication convention (env.ts, wait-for-
 * redis.ts) rather than inventing a new shared package for one type. */
interface NotificationJobData {
  channel: 'SMS';
  message: {
    to: string;
    templateKey: 'OTP';
    variables: Record<string, string>;
  };
}

/**
 * How long a job carrying a live OTP code is allowed to sit in Redis
 * after it's done. `removeOnComplete: true` prunes it immediately — no
 * reason to keep a plaintext code around once delivery succeeded.
 * `removeOnFail` keeps a bounded number for operator debugging (a real
 * delivery failure is worth being able to inspect) without keeping every
 * failed code forever — same "bounded, not indefinite" reasoning as
 * every retention choice in this codebase. No `attempts`/retry option
 * (defaults to 1): an OTP's own short TTL (`OTP_TTL_SECONDS`, 5 minutes
 * by default) makes a delayed-and-retried delivery pointless — the code
 * would likely already be expired by the time a backoff-retried attempt
 * ran, and every retry window is more time the code spends live in
 * Redis. See docs/security/notification-security.md for the full
 * account.
 */
const OTP_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: { count: 50 },
} as const;

/**
 * CP-017 — the one real producer onto the `notifications` queue that
 * `services/notification-worker` consumes. `services/api` commits its own
 * transaction (the `OtpRequest` row) before this is ever called — see
 * `RequestOtpUseCase`, which never awaits a provider round-trip and never
 * fails its own response because this failed (blueprint §39's own
 * "producer commits first, enqueues after" rule, same precedent every
 * other queue producer in this repo already follows).
 */
@Injectable()
export class BullmqOtpNotificationAdapter implements OtpNotificationPort {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<NotificationJobData>,
  ) {}

  async sendOtpSms(props: { phone: string; code: string; purpose: OtpPurpose }): Promise<void> {
    await this.queue.add(
      'send-otp-sms',
      {
        channel: 'SMS',
        message: {
          to: props.phone,
          templateKey: 'OTP',
          // The code is transient job payload, not a durable record — same
          // "Redis holds only scheduling state, never a source of truth"
          // invariant CP-016 documented; see this file's own
          // OTP_JOB_OPTIONS doc comment and
          // docs/security/notification-security.md for the resulting
          // at-rest-in-Redis exposure window and how it's bounded.
          variables: { code: props.code, purpose: props.purpose },
        },
      },
      OTP_JOB_OPTIONS,
    );
  }
}
