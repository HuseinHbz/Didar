import { prisma } from '@iecp/database';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';

/**
 * Liveness/readiness endpoint for load balancers, container orchestration, and
 * uptime monitoring (blueprint §102). Deliberately has no auth — it must stay
 * reachable even when everything else is unhealthy.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.checkDatabase()]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('database');
    try {
      await prisma.$queryRaw`SELECT 1`;
      return indicator.up();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return indicator.down({ message });
    }
  }
}
