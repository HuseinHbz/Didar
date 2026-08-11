import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type {
  NotificationChannelPort,
  NotificationMessage,
  NotificationSendResult,
  NotificationSendStatus,
} from '../notification-channel.port';

/** ⚠️ Stub — no real SMTP/transactional-email provider wired yet. */
@Injectable()
export class EmailAdapter implements NotificationChannelPort {
  readonly channel = 'EMAIL' as const;
  private readonly logger = new Logger(EmailAdapter.name);
  private readonly statuses = new Map<string, NotificationSendStatus>();

  send(message: NotificationMessage): Promise<NotificationSendResult> {
    this.logger.log(`[stub] Email -> ${message.to} (template: ${message.templateKey})`);
    const id = randomUUID();
    this.statuses.set(id, 'sent');
    return Promise.resolve({ id, status: 'sent' });
  }

  getStatus(id: string): Promise<NotificationSendStatus> {
    return Promise.resolve(this.statuses.get(id) ?? 'failed');
  }
}
