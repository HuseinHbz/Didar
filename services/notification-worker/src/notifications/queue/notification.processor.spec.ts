import type { Job } from 'bullmq';

import type { NotificationDispatcherService } from '../notification-dispatcher.service';

import { NotificationProcessor, type NotificationJobData } from './notification.processor';

/**
 * CP-017 — unit coverage for the one seam BullMQ itself owns: whatever
 * `process()` returns/throws is exactly what marks a job completed/failed.
 * `NotificationDispatcherService`'s own routing/fallback behavior is already
 * covered by its own spec — this file only proves the processor is a thin,
 * faithful pass-through (result on success, rejection propagated on
 * failure — never swallowed into a false "completed").
 */
describe('NotificationProcessor', () => {
  const job = {
    id: 'job-1',
    data: { channel: 'SMS', message: { to: '+989121234567', templateKey: 'OTP', variables: {} } },
  } as Job<NotificationJobData>;

  it('resolves with the dispatcher result on success', async () => {
    const dispatcher = {
      dispatch: jest.fn().mockResolvedValue({ id: 'sms-1', status: 'sent' }),
    } as unknown as NotificationDispatcherService;
    const processor = new NotificationProcessor(dispatcher);

    await expect(processor.process(job)).resolves.toEqual({ id: 'sms-1', status: 'sent' });
    expect(dispatcher.dispatch).toHaveBeenCalledWith('SMS', job.data.message);
  });

  it('propagates a dispatcher rejection rather than swallowing it — this is what BullMQ reads as a failed job', async () => {
    const dispatcher = {
      dispatch: jest.fn().mockRejectedValue(new Error('no adapter registered for channel "BOGUS"')),
    } as unknown as NotificationDispatcherService;
    const processor = new NotificationProcessor(dispatcher);

    await expect(processor.process(job)).rejects.toThrow(
      'no adapter registered for channel "BOGUS"',
    );
  });
});
