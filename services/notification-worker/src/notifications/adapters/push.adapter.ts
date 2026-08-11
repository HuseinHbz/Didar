import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type {
  NotificationChannelPort,
  NotificationMessage,
  NotificationSendResult,
  NotificationSendStatus,
} from '../notification-channel.port';

/** ⚠️ Stub — no real push provider (FCM/APNs) wired yet. `to` is a device token. */
@Injectable()
export class PushAdapter implements NotificationChannelPort {
  readonly channel = 'PUSH' as const;
  private readonly logger = new Logger(PushAdapter.name);
  private readonly statuses = new Map<string, NotificationSendStatus>();

  send(message: NotificationMessage): Promise<NotificationSendResult> {
    this.logger.log(`[stub] Push -> device ${message.to} (template: ${message.templateKey})`);
    const id = randomUUID();
    this.statuses.set(id, 'sent');
    return Promise.resolve({ id, status: 'sent' });
  }

  getStatus(id: string): Promise<NotificationSendStatus> {
    return Promise.resolve(this.statuses.get(id) ?? 'failed');
  }
}
