import type { NotificationChannel } from '@iecp/types';

export type NotificationSendStatus = 'sent' | 'failed' | 'queued';

export interface NotificationSendResult {
  id: string;
  status: NotificationSendStatus;
}

export interface NotificationMessage {
  /** Adapter-specific recipient — phone number, chat id, email address, device token. */
  to: string;
  /** Looked up against notification_templates (blueprint §44) — never inline text. */
  templateKey: string;
  variables: Record<string, string>;
}

/**
 * One implementation per channel (blueprint §38). Deliberately excludes
 * `schedule()`/`cancel()` from the per-channel contract — scheduling is handled
 * once, centrally, as delayed BullMQ jobs at the dispatcher level (see
 * `NotificationDispatcherService`), rather than duplicated in every adapter.
 */
export interface NotificationChannelPort {
  readonly channel: NotificationChannel;
  send(message: NotificationMessage): Promise<NotificationSendResult>;
  getStatus(id: string): Promise<NotificationSendStatus>;
}

export const NOTIFICATION_CHANNEL_ADAPTERS = Symbol('NOTIFICATION_CHANNEL_ADAPTERS');
