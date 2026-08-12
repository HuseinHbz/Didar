import { prisma, type UserDevice as PrismaDevice } from '@iecp/database';
import type { DeviceId, UserId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Device } from '../../domain/entities/device.entity';
import type { DeviceRepositoryPort } from '../../domain/ports/device.repository.port';

@Injectable()
export class PrismaDeviceRepository implements DeviceRepositoryPort {
  async findOrTouch(props: {
    userId: UserId;
    fingerprint: string;
    label?: string | null;
    platform?: string | null;
    now: Date;
  }): Promise<Device> {
    const row = await prisma.userDevice.upsert({
      where: { userId_fingerprint: { userId: props.userId, fingerprint: props.fingerprint } },
      update: { lastSeenAt: props.now },
      create: {
        userId: props.userId,
        fingerprint: props.fingerprint,
        label: props.label ?? null,
        platform: props.platform ?? null,
        lastSeenAt: props.now,
      },
    });
    return toDomain(row);
  }

  async findById(id: DeviceId): Promise<Device | null> {
    const row = await prisma.userDevice.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async trust(id: DeviceId, at: Date): Promise<void> {
    await prisma.userDevice.update({ where: { id }, data: { trustedAt: at } });
  }

  async revoke(id: DeviceId, at: Date): Promise<void> {
    await prisma.userDevice.update({ where: { id }, data: { revokedAt: at } });
  }

  async listForUser(userId: UserId): Promise<Device[]> {
    const rows = await prisma.userDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: PrismaDevice): Device {
  return Device.create({
    id: row.id,
    userId: row.userId,
    fingerprint: row.fingerprint,
    label: row.label,
    platform: row.platform,
    trustedAt: row.trustedAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  });
}
