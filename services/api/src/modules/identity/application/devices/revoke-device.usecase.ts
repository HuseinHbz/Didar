import type { DeviceId, UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  DEVICE_REPOSITORY,
  type DeviceRepositoryPort,
} from '../../domain/ports/device.repository.port';
import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import {
  SESSION_REPOSITORY,
  type SessionRepositoryPort,
} from '../../domain/ports/session.repository.port';

/** Revoking a device also revokes every active session tied to it — a
 * device you no longer trust shouldn't keep a live refresh token around
 * just because its individual session wasn't revoked separately. */
@Injectable()
export class RevokeDeviceUseCase {
  constructor(
    @Inject(DEVICE_REPOSITORY) private readonly devices: DeviceRepositoryPort,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
  ) {}

  async execute(callerUserId: UserId, deviceId: DeviceId): Promise<void> {
    const device = await this.devices.findById(deviceId);
    if (device?.userId !== callerUserId) {
      throw new NotFoundException('Device not found');
    }

    const now = new Date();
    await this.devices.revoke(deviceId, now);

    const activeSessions = await this.sessions.listActiveForUser(callerUserId, now);
    await Promise.all(
      activeSessions
        .filter((session) => session.deviceId === deviceId)
        .map((session) => this.sessions.revoke(session.id, now)),
    );

    await this.securityEvents.record({
      userId: callerUserId,
      type: 'SESSION_REVOKED',
      metadata: { deviceId },
    });
  }
}
