import type { PermissionEffect } from '@iecp/types';

/** blueprint §53's per-user exception ("Product.Publish = NO" even though the
 * user's role would otherwise grant it). See PermissionResolver for how
 * `effect` interacts with role-derived grants — DENY always wins. */
export class PermissionOverride {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly permissionKey: string,
    public readonly effect: PermissionEffect,
    public readonly reason: string | null,
    public readonly createdBy: string | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    userId: string;
    permissionKey: string;
    effect: PermissionEffect;
    reason?: string | null;
    createdBy?: string | null;
    createdAt: Date;
  }): PermissionOverride {
    return new PermissionOverride(
      props.id,
      props.userId,
      props.permissionKey,
      props.effect,
      props.reason ?? null,
      props.createdBy ?? null,
      props.createdAt,
    );
  }
}
