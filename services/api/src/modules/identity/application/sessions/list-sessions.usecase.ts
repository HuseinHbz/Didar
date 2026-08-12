import type { UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import type { Session } from '../../domain/entities/session.entity';
import {
  SESSION_REPOSITORY,
  type SessionRepositoryPort,
} from '../../domain/ports/session.repository.port';

/** blueprint §55 "Active Sessions" — the caller's own, always (never someone
 * else's without a separate admin-scoped endpoint/permission). */
@Injectable()
export class ListSessionsUseCase {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort) {}

  async execute(userId: UserId): Promise<Session[]> {
    return this.sessions.listActiveForUser(userId, new Date());
  }
}
