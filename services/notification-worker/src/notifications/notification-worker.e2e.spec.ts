import { Test, type TestingModule } from '@nestjs/testing';
import { Queue, QueueEvents } from 'bullmq';

import { AppModule } from '../app.module';

import type { NotificationJobData } from './queue/notification.processor';

/**
 * CP-017 — real Redis, real BullMQ `Worker` (created internally by Nest's
 * `@Processor('notifications')` the moment `AppModule` boots — the exact
 * same object graph `main.ts` builds in production, not a stand-in), and a
 * separate raw `bullmq` `Queue` acting as an external producer (mirroring
 * `services/api`'s own `BullmqOtpNotificationAdapter`). This is the
 * automated version of the manual runtime proof CP-017's own validation
 * audit already performed once by hand (boot + drain a real backlog +
 * clean shutdown) — pinned here as a repeatable regression, matching
 * `otp-notification.e2e-spec.ts`'s own "real Redis, no mocks" convention
 * from the producer side of this same queue.
 *
 * Requires a reachable REDIS_URL (same requirement every other real-Redis
 * spec in this repo already has).
 */
describe('Notification worker (e2e) — real Redis, real BullMQ worker', () => {
  let app: TestingModule;
  let queue: Queue<NotificationJobData>;
  let queueEvents: QueueEvents;
  const connection = { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' };

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();

    queue = new Queue<NotificationJobData>('notifications', { connection });
    queueEvents = new QueueEvents('notifications', { connection });
    await queueEvents.waitUntilReady();
  });

  afterAll(async () => {
    await queueEvents.close();
    await queue.close();
    await app.close();
  }, 20_000);

  it('processes a real job end to end and marks it completed', async () => {
    const job = await queue.add(
      'send-otp-sms',
      {
        channel: 'SMS',
        message: { to: '+989121234567', templateKey: 'OTP', variables: { code: '123456' } },
      },
      { removeOnComplete: true, removeOnFail: { count: 50 } },
    );

    const result = await job.waitUntilFinished(queueEvents, 10_000);

    expect(result).toEqual({ status: 'sent', id: expect.any(String) });
  }, 15_000);

  it("isolates a malformed job's failure — the job fails, but the worker keeps processing the next one", async () => {
    // A job with a channel no adapter is registered for — the same
    // shape a producer bug, or a channel retired after jobs were
    // already enqueued, would leave behind. `NotificationDispatcherService`
    // throws synchronously for this; BullMQ must record it as a real
    // job failure, not silently drop it or wedge the worker.
    const badJob = await queue.add(
      'send-bad-channel',
      {
        channel: 'BOGUS',
        message: { to: '+989121234567', templateKey: 'OTP', variables: {} },
      } as unknown as NotificationJobData,
      { removeOnComplete: true, removeOnFail: { count: 50 } },
    );

    await expect(badJob.waitUntilFinished(queueEvents, 10_000)).rejects.toThrow(
      /No adapter registered for channel "BOGUS"/,
    );

    // The worker process is still alive and still consuming — prove it
    // with a normal follow-up job, not an assumption.
    const goodJob = await queue.add(
      'send-otp-sms',
      {
        channel: 'SMS',
        message: { to: '+989121234567', templateKey: 'OTP', variables: { code: '654321' } },
      },
      { removeOnComplete: true, removeOnFail: { count: 50 } },
    );
    const result = await goodJob.waitUntilFinished(queueEvents, 10_000);
    expect(result).toEqual({ status: 'sent', id: expect.any(String) });
  }, 25_000);

  it('keeps failed-job retention bounded — old failures get pruned once the count is exceeded', async () => {
    const retainCount = 2;
    const ids: string[] = [];
    for (let i = 0; i < retainCount + 2; i += 1) {
      const job = await queue.add(
        'send-bad-channel',
        {
          channel: 'BOGUS',
          message: { to: '+989121234567', templateKey: 'OTP', variables: { attempt: String(i) } },
        } as unknown as NotificationJobData,
        { removeOnComplete: true, removeOnFail: { count: retainCount } },
      );
      await expect(job.waitUntilFinished(queueEvents, 10_000)).rejects.toThrow();
      if (job.id !== undefined) ids.push(job.id);
    }

    const failed = await queue.getJobs(['failed'], 0, -1);
    const stillPresent = ids.filter((id) => failed.some((j) => j.id === id));
    // Only the most recent `retainCount` of the batch this test itself
    // added should still be retrievable — never every failure ever
    // produced across this whole test file's run.
    expect(stillPresent.length).toBeLessThanOrEqual(retainCount);
  }, 30_000);

  it('shuts down gracefully and promptly (enableShutdownHooks/onModuleDestroy) — no hang', async () => {
    const isolated: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await isolated.init();

    const startedAt = Date.now();
    await isolated.close();

    expect(Date.now() - startedAt).toBeLessThan(5_000);
  }, 10_000);
});
