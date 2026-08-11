import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type {
  NotificationChannelPort,
  NotificationMessage,
  NotificationSendResult,
  NotificationSendStatus,
} from '../notification-channel.port';

/**
 * Telegram Bot adapter (blueprint §42). Treated as a complementary channel, not
 * load-bearing — access to Telegram inside Iran can vary, so nothing critical
 * (OTP, order confirmation) should depend on it alone. See
 * `NotificationDispatcherService` for the SMS fallback.
 *
 * ⚠️ Stub — no real Telegram Bot API call wired yet.
 */
@Injectable()
export class TelegramAdapter implements NotificationChannelPort {
  readonly channel = 'TELEGRAM' as const;
  private readonly logger = new Logger(TelegramAdapter.name);
  private readonly statuses = new Map<string, NotificationSendStatus>();

  send(message: NotificationMessage): Promise<NotificationSendResult> {
    this.logger.log(`[stub] Telegram -> ${message.to} (template: ${message.templateKey})`);
    const id = randomUUID();
    this.statuses.set(id, 'sent');
    return Promise.resolve({ id, status: 'sent' });
  }

  getStatus(id: string): Promise<NotificationSendStatus> {
    return Promise.resolve(this.statuses.get(id) ?? 'failed');
  }
}
