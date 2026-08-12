import { prisma, type SecurityEvent as PrismaSecurityEvent } from '@iecp/database';
import type { SecurityEventType } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { SecurityEvent } from '../../domain/entities/security-event.entity';
import type { SecurityEventRepositoryPort } from '../../domain/ports/security-event.repository.port';

@Injectable()
export class PrismaSecurityEventRepository implements SecurityEventRepositoryPort {
  async record(entry: {
    userId?: string | null;
    type: SecurityEventType;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: unknown;
  }): Promise<void> {
    await prisma.securityEvent.create({
      data: {
        userId: entry.userId ?? null,
        type: entry.type,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: entry.metadata ?? undefined,
      },
    });
  }

  async listForUser(userId: string, limit: number): Promise<SecurityEvent[]> {
    const rows = await prisma.securityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: PrismaSecurityEvent): SecurityEvent {
  return SecurityEvent.create({
    id: row.id,
    userId: row.userId,
    type: row.type,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: row.metadata,
    createdAt: row.createdAt,
  });
}
