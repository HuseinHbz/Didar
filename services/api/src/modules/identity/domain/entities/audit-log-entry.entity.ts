/** system.AuditLog (blueprint §54) — the general "who changed what" record.
 * Read-side entity; writing goes through AuditLogRepositoryPort.record(), which
 * takes a plain data bag (see that port) rather than requiring callers to
 * construct one of these first. */
export class AuditLogEntry {
  private constructor(
    public readonly id: string,
    public readonly actorId: string | null,
    public readonly actorIp: string | null,
    public readonly actorDevice: string | null,
    public readonly action: string,
    public readonly entityType: string,
    public readonly entityId: string,
    public readonly oldValue: unknown,
    public readonly newValue: unknown,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    actorId?: string | null;
    actorIp?: string | null;
    actorDevice?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
    createdAt: Date;
  }): AuditLogEntry {
    return new AuditLogEntry(
      props.id,
      props.actorId ?? null,
      props.actorIp ?? null,
      props.actorDevice ?? null,
      props.action,
      props.entityType,
      props.entityId,
      props.oldValue ?? null,
      props.newValue ?? null,
      props.createdAt,
    );
  }
}
