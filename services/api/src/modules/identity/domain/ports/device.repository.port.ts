import type { DeviceId, UserId } from '@iecp/types';

import type { Device } from '../entities/device.entity';

export const DEVICE_REPOSITORY = Symbol('DEVICE_REPOSITORY');

export interface DeviceRepositoryPort {
  /** Looks up `(userId, fingerprint)`; creates the row on first sight,
   * otherwise bumps `lastSeenAt` on the existing one. One device row
   * survives many logins/sessions from the same install. */
  findOrTouch(props: {
    userId: UserId;
    fingerprint: string;
    label?: string | null;
    platform?: string | null;
    now: Date;
  }): Promise<Device>;
  findById(id: DeviceId): Promise<Device | null>;
  trust(id: DeviceId, at: Date): Promise<void>;
  revoke(id: DeviceId, at: Date): Promise<void>;
  listForUser(userId: UserId): Promise<Device[]>;
}
