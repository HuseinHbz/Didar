import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsController } from './metrics.controller';
import { QueueMetricsService } from './queue-metrics.service';

/**
 * CP-029 (P1-5) — closes the `/metrics` half of gap-priority-matrix.md's
 * P1-5 ("No production observability (no /metrics, no alerting, no
 * runbook)"). See `docs/adr/ADR-029-production-readiness-completion.md`
 * §3 for what this module does and does not cover, and
 * `docs/product/phase-029-audit.md` for the full evidence trail.
 */
@Module({
  controllers: [MetricsController],
  providers: [QueueMetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
