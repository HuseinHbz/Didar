import { PrismaClient } from '@prisma/client';

/**
 * Singleton PrismaClient.
 *
 * In dev, Next.js/ts-node hot-reloading re-evaluates modules on every change, which
 * would otherwise open a fresh pool of DB connections each time. Caching the client
 * on `globalThis` (dev only) avoids exhausting the Postgres connection limit.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}
