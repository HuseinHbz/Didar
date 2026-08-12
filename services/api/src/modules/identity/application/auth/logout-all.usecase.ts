import type { UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import {
  SESSION_REPOSITORY,
  type SessionRepositoryPort,
} from '../../domain/ports/session.repository.port';

/** blueprint §55 "Session Control" — "log out everywhere", e.g. after a
 * password change or a user reporting a lost device. */
@Injectable()
export class LogoutAllUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
  ) {}

  async execute(userId: UserId): Promise<void> {
    await this.sessions.revokeAllForUser(userId, new Date());
    await this.securityEvents.record({
      userId,
      type: 'SESSION_REVOKED',
      metadata: { scope: 'ALL_SESSIONS' },
    });
  }
}
