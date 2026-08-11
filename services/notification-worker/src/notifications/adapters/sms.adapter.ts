import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type {
  NotificationChannelPort,
  NotificationMessage,
  NotificationSendResult,
  NotificationSendStatus,
} from '../notification-channel.port';

/**
 * SMS adapter — the reliability backbone for Iran (blueprint §41/§43): every other
 * channel is allowed to fail over to this one, this one is not allowed to fail
 * over to anything else.
 *
 * ⚠️ Stub: no real provider wired yet. `send()` logs and returns a synthetic
 * "sent" result instead of calling a provider — swap the body of `send()` for a
 * real `SMS Provider abstraction` (blueprint §43) implementation, keep the
 * `NotificationChannelPort` contract.
 */
@Injectable()
export class SmsAdapter implements NotificationChannelPort {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger(SmsAdapter.name);
  private readonly statuses = new Map<string, NotificationSendStatus>();

  async send(message: NotificationMessage): Promise<NotificationSendResult> {
    this.logger.log(`[stub] SMS -> ${message.to} (template: ${message.templateKey})`);
    const id = randomUUID();
    this.statuses.set(id, 'sent');
    return Promise.resolve({ id, status: 'sent' });
  }

  getStatus(id: string): Promise<NotificationSendStatus> {
    return Promise.resolve(this.statuses.get(id) ?? 'failed');
  }
}
