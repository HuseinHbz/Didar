import type { AuditLogEntry } from '../entities/audit-log-entry.entity';

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

export interface AuditLogRepositoryPort {
  record(entry: {
    actorId?: string | null;
    actorIp?: string | null;
    actorDevice?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
  }): Promise<void>;
  list(filter: {
    entityType?: string;
    entityId?: string;
    actorId?: string;
    limit: number;
    /** Opaque cursor from a previous page's `nextCursor` — see the Prisma
     * implementation for what it actually encodes. */
    cursor?: string | null;
  }): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }>;
}
