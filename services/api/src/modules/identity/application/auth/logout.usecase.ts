import { Inject, Injectable } from '@nestjs/common';

import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import {
  SESSION_REPOSITORY,
  type SessionRepositoryPort,
} from '../../domain/ports/session.repository.port';
import { sha256Hex } from '../../infrastructure/crypto/hash.util';

/** Idempotent by design: an already-revoked or unrecognized refresh token
 * still returns success — logout never leaks whether a token was valid. */
@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
  ) {}

  async execute(refreshToken: string): Promise<void> {
    const session = await this.sessions.findByRefreshTokenHash(sha256Hex(refreshToken));
    if (!session) {
      return;
    }
    await this.sessions.revoke(session.id, new Date());
    await this.securityEvents.record({ userId: session.userId, type: 'SESSION_REVOKED' });
  }
}
