import { prisma } from '@iecp/database';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

/**
 * Template scheduled task, proving the @nestjs/schedule + Prisma wiring end to
 * end. Not a real business task — replace once the first real one is designed
 * (e.g. cart-abandonment reminders §69, retention nudges §128, nightly report
 * rollups §102). This one just logs a row count.
 */
@Injectable()
export class ExampleTask {
  private readonly logger = new Logger(ExampleTask.name);

  @Cron(CronExpression.EVERY_HOUR)
  async logUserCount(): Promise<void> {
    const count = await prisma.user.count();
    this.logger.log(`[example task] users table has ${count} row(s)`);
  }
}
