import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import type { ExampleJobData } from './example.processor';

/** Producer side of the example queue — this is what a domain module would inject. */
@Injectable()
export class ExampleQueueService {
  constructor(@InjectQueue('example') private readonly queue: Queue<ExampleJobData>) {}

  async enqueue(data: ExampleJobData): Promise<string> {
    const job = await this.queue.add('example-job', data);
    return job.id ?? '';
  }
}
