import type { PermissionId, RoleId } from '@iecp/types';

import type { Permission } from '../entities/permission.entity';

export const PERMISSION_REPOSITORY = Symbol('PERMISSION_REPOSITORY');

export interface PermissionRepositoryPort {
  findById(id: PermissionId): Promise<Permission | null>;
  findByKey(key: string): Promise<Permission | null>;
  list(): Promise<Permission[]>;
  /** Flat, deduplicated set of permission keys granted to ANY of the given roles. */
  listKeysForRoles(roleIds: RoleId[]): Promise<string[]>;
  grantToRole(roleId: RoleId, permissionId: PermissionId): Promise<void>;
  revokeFromRole(roleId: RoleId, permissionId: PermissionId): Promise<void>;
}
