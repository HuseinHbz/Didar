/**
 * Shared cursor-pagination helpers for the inventory module's Prisma
 * repositories — identical shape/behavior to
 * `modules/catalog/infrastructure/pagination.util.ts` (itself generalized
 * from identity's audit-log cursor). Copied rather than imported across
 * modules on purpose — same per-module-self-contained precedent Phase 005
 * already established, not an oversight.
 */

interface Cursor {
  sortValue: string;
  id: string;
}

export function encodeCursor(sortValue: string, id: string): string {
  const cursor: Cursor = { sortValue, id };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(encoded: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'sortValue' in parsed &&
      'id' in parsed &&
      typeof (parsed as Cursor).sortValue === 'string' &&
      typeof (parsed as Cursor).id === 'string'
    ) {
      return parsed as Cursor;
    }
    throw new Error('shape mismatch');
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}

/** Splits a `limit + 1`-sized page into `{page, hasMore}`. */
export function splitPage<T>(rows: T[], limit: number): { page: T[]; hasMore: boolean } {
  const hasMore = rows.length > limit;
  return { page: hasMore ? rows.slice(0, limit) : rows, hasMore };
}
