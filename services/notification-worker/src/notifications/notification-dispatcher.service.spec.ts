import type { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env';

import { EmailAdapter } from './adapters/email.adapter';
import { InAppAdapter } from './adapters/in-app.adapter';
import { PushAdapter } from './adapters/push.adapter';
import { SmsAdapter } from './adapters/sms.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { NotificationDispatcherService } from './notification-dispatcher.service';

describe('NotificationDispatcherService', () => {
  const message = { to: '+989121234567', templateKey: 'ORDER_CREATED', variables: {} };

  // No SMS_API_KEY configured -> SmsAdapter's own documented stub-fallback
  // path (see its class doc comment) — exactly what these two tests want,
  // no real Kavenegar call.
  const noSmsConfig = { get: () => undefined } as unknown as ConfigService<Env, true>;

  it('falls back to SMS when WhatsApp fails (blueprint §41)', async () => {
    const sms = new SmsAdapter(noSmsConfig);
    const whatsapp = new WhatsappAdapter();
    jest.spyOn(whatsapp, 'send').mockRejectedValueOnce(new Error('provider down'));
    const smsSendSpy = jest.spyOn(sms, 'send');

    const dispatcher = new NotificationDispatcherService(
      sms,
      new TelegramAdapter(),
      whatsapp,
      new EmailAdapter(),
      new PushAdapter(),
      new InAppAdapter(),
    );

    const result = await dispatcher.dispatch('WHATSAPP', message);

    expect(smsSendSpy).toHaveBeenCalledWith(message);
    expect(result.status).toBe('sent');
  });

  it('does not fall back for a channel outside the fallback set (e.g. EMAIL)', async () => {
    const email = new EmailAdapter();
    jest.spyOn(email, 'send').mockRejectedValueOnce(new Error('smtp down'));

    const dispatcher = new NotificationDispatcherService(
      new SmsAdapter(noSmsConfig),
      new TelegramAdapter(),
      new WhatsappAdapter(),
      email,
      new PushAdapter(),
      new InAppAdapter(),
    );

    await expect(dispatcher.dispatch('EMAIL', message)).rejects.toThrow('smtp down');
  });
});
