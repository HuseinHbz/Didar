import { prisma, type AuditLog as PrismaAuditLog, type Prisma } from '@iecp/database';
import { Injectable } from '@nestjs/common';

import { AuditLogEntry } from '../../domain/entities/audit-log-entry.entity';
import type { AuditLogRepositoryPort } from '../../domain/ports/audit-log.repository.port';

interface Cursor {
  createdAt: string; // ISO
  id: string;
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  const cursor: Cursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(encoded: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'createdAt' in parsed &&
      'id' in parsed &&
      typeof (parsed as Cursor).createdAt === 'string' &&
      typeof (parsed as Cursor).id === 'string'
    ) {
      return parsed as Cursor;
    }
    throw new Error('shape mismatch');
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  async record(entry: {
    actorId?: string | null;
    actorIp?: string | null;
    actorDevice?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorIp: entry.actorIp ?? null,
        actorDevice: entry.actorDevice ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        oldValue: entry.oldValue ?? undefined,
        newValue: entry.newValue ?? undefined,
      },
    });
  }

  async list(filter: {
    entityType?: string;
    entityId?: string;
    actorId?: string;
    limit: number;
    cursor?: string | null;
  }): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> {
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.entityType && { entityType: filter.entityType }),
      ...(filter.entityId && { entityId: filter.entityId }),
      ...(filter.actorId && { actorId: filter.actorId }),
    };

    if (filter.cursor) {
      const { createdAt, id } = decodeCursor(filter.cursor);
      where.OR = [
        { createdAt: { lt: new Date(createdAt) } },
        { createdAt: new Date(createdAt), id: { lt: id } },
      ];
    }

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }
}

function toDomain(row: PrismaAuditLog): AuditLogEntry {
  return AuditLogEntry.create({
    id: row.id,
    actorId: row.actorId,
    actorIp: row.actorIp,
    actorDevice: row.actorDevice,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    oldValue: row.oldValue,
    newValue: row.newValue,
    createdAt: row.createdAt,
  });
}
