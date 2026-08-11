import type { Job, Queue } from 'bullmq';

import { ExampleQueueService } from './example-queue.service';
import type { ExampleJobData } from './example.processor';

describe('ExampleQueueService', () => {
  it('enqueues a job and returns its id', async () => {
    // Typed to match exactly what ExampleQueueService's constructor expects
    // (Queue<ExampleJobData>) — a bare, unparameterized `Queue` structurally
    // mismatches on BullMQ's other six generic params and reads as an `any` leak.
    const fakeQueue = {
      add: () => Promise.resolve({ id: 'job-1' } as Job<ExampleJobData>),
    } as unknown as Queue<ExampleJobData>;

    const service = new ExampleQueueService(fakeQueue);

    await expect(service.enqueue({ message: 'hello' })).resolves.toBe('job-1');
  });
});
