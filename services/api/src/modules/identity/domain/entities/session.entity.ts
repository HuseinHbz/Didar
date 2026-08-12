import {
  asDeviceId,
  asSessionId,
  asUserId,
  type DeviceId,
  type SessionId,
  type UserId,
} from '@iecp/types';

/** One issued refresh token (blueprint §55/§56). `refreshTokenHash` is never
 * the raw token — see JwtTokenService for how the raw value is generated and
 * hashed before this entity/its row ever sees it. */
export class Session {
  private constructor(
    public readonly id: SessionId,
    public readonly userId: UserId,
    public readonly deviceId: DeviceId | null,
    public readonly refreshTokenHash: string,
    public readonly userAgent: string | null,
    public readonly ipAddress: string | null,
    public readonly expiresAt: Date,
    public readonly revokedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    userId: string;
    deviceId?: string | null;
    refreshTokenHash: string;
    userAgent?: string | null;
    ipAddress?: string | null;
    expiresAt: Date;
    revokedAt?: Date | null;
    createdAt: Date;
  }): Session {
    return new Session(
      asSessionId(props.id),
      asUserId(props.userId),
      props.deviceId ? asDeviceId(props.deviceId) : null,
      props.refreshTokenHash,
      props.userAgent ?? null,
      props.ipAddress ?? null,
      props.expiresAt,
      props.revokedAt ?? null,
      props.createdAt,
    );
  }

  /** Pure business rule — no I/O, no clock injection needed beyond `now`. */
  isActive(now: Date): boolean {
    return this.revokedAt === null && this.expiresAt > now;
  }
}
