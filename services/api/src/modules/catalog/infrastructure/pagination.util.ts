/**
 * Shared cursor-pagination helpers for the catalog module's Prisma
 * repositories — same base64url `{sortValue, id}` shape and `limit + 1`
 * "peek ahead" technique identity's `PrismaAuditLogRepository` established
 * (see that file), generalized here to any single orderable field (not
 * just `createdAt`) since Product listing needs to sort by createdAt,
 * publishedAt, or name depending on the caller.
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
