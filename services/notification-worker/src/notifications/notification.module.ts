import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { EmailAdapter } from './adapters/email.adapter';
import { InAppAdapter } from './adapters/in-app.adapter';
import { PushAdapter } from './adapters/push.adapter';
import { SmsAdapter } from './adapters/sms.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationProcessor } from './queue/notification.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'notifications' })],
  providers: [
    SmsAdapter,
    TelegramAdapter,
    WhatsappAdapter,
    EmailAdapter,
    PushAdapter,
    InAppAdapter,
    NotificationDispatcherService,
    NotificationProcessor,
  ],
  exports: [NotificationDispatcherService],
})
export class NotificationModule {}
