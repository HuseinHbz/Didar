/**
 * Development seed script (blueprint §107): admin user, demo users, brands,
 * categories, products, stores, coupons. Placeholder until the real domain model
 * (Phase 1 ERD) exists — intentionally seeds nothing yet beyond proving the script
 * wiring works end to end (`pnpm --filter @iecp/database seed`).
 */
import { prisma } from '../src/client.js';

async function main(): Promise<void> {
  const count = await prisma.user.count();
  console.log(`[seed] users table currently has ${count} row(s). Nothing to seed yet.`);
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
