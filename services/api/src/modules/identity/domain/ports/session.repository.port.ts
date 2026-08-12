import type { DeviceId, SessionId, UserId } from '@iecp/types';

import type { Session } from '../entities/session.entity';

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export interface SessionRepositoryPort {
  create(props: {
    userId: UserId;
    deviceId?: DeviceId | null;
    refreshTokenHash: string;
    userAgent?: string | null;
    ipAddress?: string | null;
    expiresAt: Date;
  }): Promise<Session>;
  findById(id: SessionId): Promise<Session | null>;
  findByRefreshTokenHash(hash: string): Promise<Session | null>;
  revoke(id: SessionId, at: Date): Promise<void>;
  revokeAllForUser(userId: UserId, at: Date): Promise<void>;
  listActiveForUser(userId: UserId, now: Date): Promise<Session[]>;
}
