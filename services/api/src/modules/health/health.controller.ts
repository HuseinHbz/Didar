import { prisma } from '@iecp/database';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';

import { pingRedisOnce } from '../../bootstrap/wait-for-redis';
import { Public } from '../../common/decorators/public.decorator';
import { loadEnv } from '../../config/env';

/**
 * Liveness/readiness endpoints for load balancers, container orchestration,
 * and uptime monitoring (blueprint §102). Deliberately has no auth on either
 * route — both must stay reachable even when everything else is unhealthy.
 * `@Public()` is what actually enforces that against Phase 004's global
 * JwtAuthGuard — this comment alone stopped being enough the moment that
 * guard shipped (caught by booting the app for real and hitting this route,
 * not by review).
 *
 * CP-016 split (see docs/architecture/redis-reliability.md): `GET /health`
 * keeps its original, narrower meaning — "is this process alive and can it
 * reach its database" — unchanged for any existing consumer wired to it.
 * `GET /health/ready` is new and additionally proves Redis is reachable
 * *right now*, with a real PING (`pingRedisOnce`, not a cached memory of
 * whatever `waitForRedis()` concluded once at boot) — that's the
 * distinction between liveness (the process didn't crash) and readiness
 * (every dependency this process needs is currently answering).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.checkDatabase()]);
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.checkDatabase(), () => this.checkRedis()]);
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

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('redis');
    try {
      const env = loadEnv();
      await pingRedisOnce(env.REDIS_URL);
      return indicator.up();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return indicator.down({ message });
    }
  }
}
