import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { loadEnv } from './config/env';
import { ExampleTaskModule } from './tasks/example/example.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadEnv }),
    ScheduleModule.forRoot(),
    ExampleTaskModule,
  ],
})
export class AppModule {}
