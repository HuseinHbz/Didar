import type { SecurityEventType } from '@iecp/types';

import type { SecurityEvent } from '../entities/security-event.entity';

export const SECURITY_EVENT_REPOSITORY = Symbol('SECURITY_EVENT_REPOSITORY');

export interface SecurityEventRepositoryPort {
  record(entry: {
    userId?: string | null;
    type: SecurityEventType;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: unknown;
  }): Promise<void>;
  listForUser(userId: string, limit: number): Promise<SecurityEvent[]>;
}
