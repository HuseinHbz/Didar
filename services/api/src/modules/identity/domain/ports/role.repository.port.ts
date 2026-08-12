import type { RoleId, UserId } from '@iecp/types';

import type { Role } from '../entities/role.entity';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

export interface RoleRepositoryPort {
  findById(id: RoleId): Promise<Role | null>;
  findByName(name: string): Promise<Role | null>;
  list(): Promise<Role[]>;
  create(props: {
    name: string;
    description?: string | null;
    parentId?: RoleId | null;
    isSystem?: boolean;
  }): Promise<Role>;
  update(
    id: RoleId,
    props: { name?: string; description?: string | null; parentId?: RoleId | null },
  ): Promise<Role>;

  /**
   * `assignedRoleIds` plus every ancestor reachable by following
   * `parentId`, deduplicated — the flattened set PermissionResolver treats
   * as "roles this user effectively holds" (blueprint §53 inheritance).
   * Infra's job: walk the parent chain (a handful of point lookups, cheap
   * for the shallow trees this is designed for). Cycle prevention lives in
   * the use case that sets `parentId` (`wouldCreateCycle`), not here — this
   * method assumes a cycle-free tree and would loop forever on one that
   * isn't, by design (a cheap, loud way to notice the invariant broke).
   */
  getEffectiveRoleIds(assignedRoleIds: RoleId[]): Promise<RoleId[]>;

  /** True if setting `roleId`'s parent to `candidateParentId` would create a
   * cycle (i.e. `candidateParentId` is `roleId` itself or one of its
   * current descendants). Call before every parent-changing update. */
  wouldCreateCycle(roleId: RoleId, candidateParentId: RoleId): Promise<boolean>;

  listAssignedRoleIds(userId: UserId): Promise<RoleId[]>;
  assignToUser(userId: UserId, roleId: RoleId): Promise<void>;
  unassignFromUser(userId: UserId, roleId: RoleId): Promise<void>;
}
