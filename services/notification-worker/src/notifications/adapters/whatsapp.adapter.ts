import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type {
  NotificationChannelPort,
  NotificationMessage,
  NotificationSendResult,
  NotificationSendStatus,
} from '../notification-channel.port';

/**
 * WhatsApp adapter (blueprint §41). Some official international providers (e.g.
 * Twilio) restrict messaging to +98 numbers — do not assume any one WhatsApp
 * provider is reliable for Iranian numbers. Never load-bearing on its own; see
 * `NotificationDispatcherService`'s SMS fallback.
 *
 * ⚠️ Stub — no real WhatsApp Business API call wired yet.
 */
@Injectable()
export class WhatsappAdapter implements NotificationChannelPort {
  readonly channel = 'WHATSAPP' as const;
  private readonly logger = new Logger(WhatsappAdapter.name);
  private readonly statuses = new Map<string, NotificationSendStatus>();

  send(message: NotificationMessage): Promise<NotificationSendResult> {
    this.logger.log(`[stub] WhatsApp -> ${message.to} (template: ${message.templateKey})`);
    const id = randomUUID();
    this.statuses.set(id, 'sent');
    return Promise.resolve({ id, status: 'sent' });
  }

  getStatus(id: string): Promise<NotificationSendStatus> {
    return Promise.resolve(this.statuses.get(id) ?? 'failed');
  }
}
