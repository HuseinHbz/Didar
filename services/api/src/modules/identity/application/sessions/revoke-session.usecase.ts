import type { SessionId, UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import {
  SESSION_REPOSITORY,
  type SessionRepositoryPort,
} from '../../domain/ports/session.repository.port';

/** blueprint §55 "Session Control" — revoke one device's session. Ownership
 * is enforced here, not trusted from the request: a session that exists
 * but belongs to someone else is reported as not-found, same as one that
 * doesn't exist at all, so this endpoint can never be used to probe which
 * session ids belong to other accounts. */
@Injectable()
export class RevokeSessionUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
  ) {}

  async execute(callerUserId: UserId, sessionId: SessionId): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (session?.userId !== callerUserId) {
      throw new NotFoundException('Session not found');
    }

    await this.sessions.revoke(sessionId, new Date());
    await this.securityEvents.record({ userId: callerUserId, type: 'SESSION_REVOKED' });
  }
}
