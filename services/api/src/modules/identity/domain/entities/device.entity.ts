import { asDeviceId, asUserId, type DeviceId, type UserId } from '@iecp/types';

/** blueprint §5/§56 `user_devices` — "Device Trust" for admin. */
export class Device {
  private constructor(
    public readonly id: DeviceId,
    public readonly userId: UserId,
    public readonly fingerprint: string,
    public readonly label: string | null,
    public readonly platform: string | null,
    public readonly trustedAt: Date | null,
    public readonly lastSeenAt: Date,
    public readonly revokedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    userId: string;
    fingerprint: string;
    label?: string | null;
    platform?: string | null;
    trustedAt?: Date | null;
    lastSeenAt: Date;
    revokedAt?: Date | null;
    createdAt: Date;
  }): Device {
    return new Device(
      asDeviceId(props.id),
      asUserId(props.userId),
      props.fingerprint,
      props.label ?? null,
      props.platform ?? null,
      props.trustedAt ?? null,
      props.lastSeenAt,
      props.revokedAt ?? null,
      props.createdAt,
    );
  }

  get isTrusted(): boolean {
    return this.trustedAt !== null && this.revokedAt === null;
  }
}
