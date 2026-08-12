import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { loadEnv } from './config/env';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';

/**
 * Root module. Deliberately thin: every domain gets its own module under
 * src/modules/<domain>/ (blueprint §2/§3) and is wired in here — nothing else.
 *
 * `health`, `identity`, and `catalog` exist so far — each a real
 * clean-architecture module (domain/application/infrastructure/presentation).
 * `identity` is the original template (see its README); `catalog` (Phase 005)
 * follows the same layering with a deliberately coarser application-layer
 * granularity (application services, not one use-case class per action) —
 * see src/modules/catalog/README.md.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadEnv }),
    HealthModule,
    IdentityModule,
    CatalogModule,
  ],
})
export class AppModule {}
