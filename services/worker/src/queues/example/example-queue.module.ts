import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { ExampleQueueService } from './example-queue.service';
import { ExampleProcessor } from './example.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'example' })],
  providers: [ExampleProcessor, ExampleQueueService],
  exports: [ExampleQueueService],
})
export class ExampleQueueModule {}
