import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type {
  NotificationChannelPort,
  NotificationMessage,
  NotificationSendResult,
  NotificationSendStatus,
} from '../notification-channel.port';

/**
 * In-app notifications don't call an external provider — they're a row the user
 * panel/admin panel reads (blueprint §50/§85: "Notifications" in the user
 * dashboard, the ⚠️/🔴/🟡 admin alerts). `to` is a user id.
 *
 * ⚠️ Stub — the `notifications` table doesn't exist yet (Phase 1 ERD); this only
 * logs for now. Swap the body of `send()` for a `prisma.notification.create(...)`
 * call once it does.
 */
@Injectable()
export class InAppAdapter implements NotificationChannelPort {
  readonly channel = 'IN_APP' as const;
  private readonly logger = new Logger(InAppAdapter.name);
  private readonly statuses = new Map<string, NotificationSendStatus>();

  send(message: NotificationMessage): Promise<NotificationSendResult> {
    this.logger.log(`[stub] In-app -> user ${message.to} (template: ${message.templateKey})`);
    const id = randomUUID();
    this.statuses.set(id, 'sent');
    return Promise.resolve({ id, status: 'sent' });
  }

  getStatus(id: string): Promise<NotificationSendStatus> {
    return Promise.resolve(this.statuses.get(id) ?? 'failed');
  }
}
