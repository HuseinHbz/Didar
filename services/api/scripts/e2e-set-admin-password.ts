/**
 * CP-018 e2e fixture helper — sets a real, argon2-hashed password on two
 * seeded users (`packages/database/prisma/seed.ts`) so `apps/admin`'s
 * Playwright suite can exercise the real `POST /auth/login` password
 * flow end to end, and additionally assigns the seed's own
 * `order_manager`/`returns_manager` roles to the admin fixture so it can
 * exercise the order/return operator views this phase's own smoke tests
 * cover — the seed's `admin` role is deliberately scoped to "identity +
 * catalog + inventory" only (see its own description in seed.ts) and is
 * never widened here; this only gives one already-privileged fixture
 * *user* additional roles, additively, the same way a real operations
 * team would grant a second role to a specific employee. Not run in
 * production — invoked only by `apps/admin`'s Playwright `globalSetup`,
 * against a local/CI database that has already run `pnpm db:seed`.
 *
 * Uses the exact same `argon2.hash()` call `PasswordHasherService` uses
 * (services/api/src/modules/identity/infrastructure/crypto/password-hasher.service.ts)
 * — a real credential the real `LoginWithPasswordUseCase` will verify,
 * never a faked/mocked one.
 */
import { PrismaClient } from '@iecp/database';
import * as argon2 from 'argon2';

const PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'AdminPanel!E2E-2026';

/** Both fixtures the Playwright suite logs in as: the seeded `admin`
 * (identity+catalog+inventory, plus order_manager/returns_manager added
 * below for this suite's own order/return smoke coverage) and
 * `catalog_editor` — a real, seed-documented lesser role ("can create a
 * product, cannot publish/delete/set a price") used for the real
 * server-side privilege-bypass proof in `e2e/authorization.spec.ts`
 * (Phase 8's own rule: test the API directly, a hidden button is not a
 * security boundary). */
const FIXTURE_PHONES = ['+989120000001', '+989120000004'];

const EXTRA_ADMIN_ROLES = ['order_manager', 'returns_manager'];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(PASSWORD);
    for (const phone of FIXTURE_PHONES) {
      const user = await prisma.user.update({ where: { phone }, data: { passwordHash } });
      console.log(`[e2e-set-admin-password] password set for ${user.email ?? user.phone}`);
    }

    const adminUser = await prisma.user.findUniqueOrThrow({ where: { phone: '+989120000001' } });
    for (const roleName of EXTRA_ADMIN_ROLES) {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) {
        throw new Error(`[e2e-set-admin-password] role not found in seed: ${roleName}`);
      }
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: adminUser.id, roleId: role.id } },
        update: {},
        create: { userId: adminUser.id, roleId: role.id },
      });
      console.log(`[e2e-set-admin-password] role ${roleName} assigned to ${adminUser.email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[e2e-set-admin-password] failed:', error);
  process.exitCode = 1;
});
