import { Module } from '@nestjs/common';

import { ExampleTask } from './example.task';

@Module({
  providers: [ExampleTask],
})
export class ExampleTaskModule {}
