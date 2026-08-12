import { prisma, type UserPermissionOverride as PrismaOverride } from '@iecp/database';
import type { PermissionEffect, PermissionId, UserId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { PermissionOverride } from '../../domain/entities/permission-override.entity';
import type { PermissionOverrideRepositoryPort } from '../../domain/ports/permission-override.repository.port';

type OverrideWithKey = PrismaOverride & { permission: { key: string } };

@Injectable()
export class PrismaPermissionOverrideRepository implements PermissionOverrideRepositoryPort {
  async listForUser(userId: UserId): Promise<PermissionOverride[]> {
    const rows = await prisma.userPermissionOverride.findMany({
      where: { userId },
      include: { permission: { select: { key: true } } },
    });
    return rows.map(toDomain);
  }

  async set(props: {
    userId: UserId;
    permissionId: PermissionId;
    effect: PermissionEffect;
    reason?: string | null;
    createdBy?: UserId | null;
  }): Promise<PermissionOverride> {
    const row = await prisma.userPermissionOverride.upsert({
      where: { userId_permissionId: { userId: props.userId, permissionId: props.permissionId } },
      update: { effect: props.effect, reason: props.reason ?? null },
      create: {
        userId: props.userId,
        permissionId: props.permissionId,
        effect: props.effect,
        reason: props.reason ?? null,
        createdBy: props.createdBy ?? null,
      },
      include: { permission: { select: { key: true } } },
    });
    return toDomain(row);
  }

  async clear(userId: UserId, permissionId: PermissionId): Promise<void> {
    await prisma.userPermissionOverride.deleteMany({ where: { userId, permissionId } });
  }
}

function toDomain(row: OverrideWithKey): PermissionOverride {
  return PermissionOverride.create({
    id: row.id,
    userId: row.userId,
    permissionKey: row.permission.key,
    effect: row.effect,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  });
}
