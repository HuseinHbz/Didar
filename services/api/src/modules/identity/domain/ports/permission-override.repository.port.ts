import type { PermissionEffect, PermissionId, UserId } from '@iecp/types';

import type { PermissionOverride } from '../entities/permission-override.entity';

export const PERMISSION_OVERRIDE_REPOSITORY = Symbol('PERMISSION_OVERRIDE_REPOSITORY');

export interface PermissionOverrideRepositoryPort {
  listForUser(userId: UserId): Promise<PermissionOverride[]>;
  set(props: {
    userId: UserId;
    permissionId: PermissionId;
    effect: PermissionEffect;
    reason?: string | null;
    createdBy?: UserId | null;
  }): Promise<PermissionOverride>;
  clear(userId: UserId, permissionId: PermissionId): Promise<void>;
}
