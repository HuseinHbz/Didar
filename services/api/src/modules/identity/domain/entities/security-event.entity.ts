import type { SecurityEventType } from '@iecp/types';

/** identity.SecurityEvent (blueprint §5/§55 `user_security_events`) —
 * append-only, always one of a fixed, known `type`. */
export class SecurityEvent {
  private constructor(
    public readonly id: string,
    public readonly userId: string | null,
    public readonly type: SecurityEventType,
    public readonly ipAddress: string | null,
    public readonly userAgent: string | null,
    public readonly metadata: unknown,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    userId?: string | null;
    type: SecurityEventType;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: unknown;
    createdAt: Date;
  }): SecurityEvent {
    return new SecurityEvent(
      props.id,
      props.userId ?? null,
      props.type,
      props.ipAddress ?? null,
      props.userAgent ?? null,
      props.metadata ?? null,
      props.createdAt,
    );
  }
}
