import { prisma, type UserSession as PrismaSession } from '@iecp/database';
import type { DeviceId, SessionId, UserId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Session } from '../../domain/entities/session.entity';
import type { SessionRepositoryPort } from '../../domain/ports/session.repository.port';

@Injectable()
export class PrismaSessionRepository implements SessionRepositoryPort {
  async create(props: {
    userId: UserId;
    deviceId?: DeviceId | null;
    refreshTokenHash: string;
    userAgent?: string | null;
    ipAddress?: string | null;
    expiresAt: Date;
  }): Promise<Session> {
    const row = await prisma.userSession.create({
      data: {
        userId: props.userId,
        deviceId: props.deviceId ?? null,
        refreshTokenHash: props.refreshTokenHash,
        userAgent: props.userAgent ?? null,
        ipAddress: props.ipAddress ?? null,
        expiresAt: props.expiresAt,
      },
    });
    return toDomain(row);
  }

  async findById(id: SessionId): Promise<Session | null> {
    const row = await prisma.userSession.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByRefreshTokenHash(hash: string): Promise<Session | null> {
    const row = await prisma.userSession.findUnique({ where: { refreshTokenHash: hash } });
    return row ? toDomain(row) : null;
  }

  async revoke(id: SessionId, at: Date): Promise<void> {
    await prisma.userSession.update({ where: { id }, data: { revokedAt: at } });
  }

  async revokeAllForUser(userId: UserId, at: Date): Promise<void> {
    await prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async listActiveForUser(userId: UserId, now: Date): Promise<Session[]> {
    const rows = await prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: PrismaSession): Session {
  return Session.create({
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    refreshTokenHash: row.refreshTokenHash,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  });
}
