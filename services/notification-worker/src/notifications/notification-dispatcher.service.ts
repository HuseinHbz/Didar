import type { NotificationChannel } from '@iecp/types';
import { Injectable, Logger } from '@nestjs/common';

import { EmailAdapter } from './adapters/email.adapter';
import { InAppAdapter } from './adapters/in-app.adapter';
import { PushAdapter } from './adapters/push.adapter';
import { SmsAdapter } from './adapters/sms.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import type {
  NotificationChannelPort,
  NotificationMessage,
  NotificationSendResult,
} from './notification-channel.port';

const FALLBACK_TO_SMS: ReadonlySet<NotificationChannel> = new Set(['WHATSAPP', 'TELEGRAM']);

/**
 * Routes a message to its channel adapter, with the one fallback rule the
 * blueprint calls out explicitly (§41): if WhatsApp or Telegram fails, retry once
 * over SMS instead of losing the message. Every other channel failure propagates
 * — SMS itself has no further fallback, by design.
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private readonly adapters: ReadonlyMap<NotificationChannel, NotificationChannelPort>;

  constructor(
    private readonly sms: SmsAdapter,
    telegram: TelegramAdapter,
    whatsapp: WhatsappAdapter,
    email: EmailAdapter,
    push: PushAdapter,
    inApp: InAppAdapter,
  ) {
    this.adapters = new Map<NotificationChannel, NotificationChannelPort>([
      ['SMS', sms],
      ['TELEGRAM', telegram],
      ['WHATSAPP', whatsapp],
      ['EMAIL', email],
      ['PUSH', push],
      ['IN_APP', inApp],
    ]);
  }

  async dispatch(
    channel: NotificationChannel,
    message: NotificationMessage,
  ): Promise<NotificationSendResult> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`No adapter registered for channel "${channel}"`);
    }

    try {
      return await adapter.send(message);
    } catch (error) {
      if (!FALLBACK_TO_SMS.has(channel)) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`${channel} send failed (${reason}), falling back to SMS`);
      return this.sms.send(message);
    }
  }
}
