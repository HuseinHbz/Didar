import { Inject, Injectable } from '@nestjs/common';

import type { AuditLogEntry } from '../../domain/entities/audit-log-entry.entity';
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../domain/ports/audit-log.repository.port';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** blueprint §54 — read side of the audit trail. Gated behind
 * `identity.audit_logs.view` (see presentation/audit-log.controller.ts),
 * not open to every authenticated user. */
@Injectable()
export class ListAuditLogUseCase {
  constructor(@Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort) {}

  async execute(filter: {
    entityType?: string;
    entityId?: string;
    actorId?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return this.auditLog.list({ ...filter, limit });
  }
}
