import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { loadEnv } from './config/env';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { InventoryModule } from './modules/inventory/inventory.module';

/**
 * Root module. Deliberately thin: every domain gets its own module under
 * src/modules/<domain>/ (blueprint §2/§3) and is wired in here — nothing else.
 *
 * `health`, `identity`, `catalog`, and `inventory` exist so far — each a
 * real clean-architecture module (domain/application/infrastructure/
 * presentation). `identity` is the original template (see its README);
 * `catalog` (Phase 005) and `inventory` (Phase 006) follow the same
 * layering with a deliberately coarser application-layer granularity
 * (application services, not one use-case class per action) — see each
 * module's own README. `inventory` is also the first module registering
 * its own BullMQ queues in-process (see
 * `modules/inventory/infrastructure/queues` and
 * `docs/adr/ADR-006-inventory-architecture.md` decision 8).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadEnv }),
    HealthModule,
    IdentityModule,
    CatalogModule,
    InventoryModule,
  ],
})
export class AppModule {}
