import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { loadEnv } from './config/env';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';

/**
 * Root module. Deliberately thin: every domain gets its own module under
 * src/modules/<domain>/ (blueprint §2/§3) and is wired in here — nothing else.
 *
 * Only `health` and `identity` exist so far. `identity` is a real (if minimal)
 * clean-architecture example — domain/application/infrastructure/presentation —
 * the template every other domain module should follow once the Phase 1 ERD
 * lands. See src/modules/identity/README.md.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadEnv }),
    HealthModule,
    IdentityModule,
  ],
})
export class AppModule {}
