import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';

import { metricsRegistry } from './metrics.registry';

/**
 * CP-029 (P1-5) — Prometheus scrape endpoint. `@Public()` for the same
 * reason `health.controller.ts` is: Prometheus never authenticates, so
 * without this the global `JwtAuthGuard` (Phase 004) would 401 every
 * scrape. Deliberately excluded from the global `api/v1` prefix in
 * `main.ts` (`setGlobalPrefix(..., { exclude: ['metrics'] })`) so this
 * resolves at the unprefixed `/metrics` `infrastructure/monitoring/
 * prometheus.yml` already declares — that file predates this controller
 * and is left as originally authored rather than reshaped around an
 * implementation detail.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  @Public()
  @Get()
  @Header('Content-Type', metricsRegistry.contentType)
  metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
