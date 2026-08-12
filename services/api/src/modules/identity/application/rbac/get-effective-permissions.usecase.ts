import type { UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import {
  PERMISSION_OVERRIDE_REPOSITORY,
  type PermissionOverrideRepositoryPort,
} from '../../domain/ports/permission-override.repository.port';
import {
  PERMISSION_REPOSITORY,
  type PermissionRepositoryPort,
} from '../../domain/ports/permission.repository.port';
import { ROLE_REPOSITORY, type RoleRepositoryPort } from '../../domain/ports/role.repository.port';
import { PermissionResolver } from '../../domain/services/permission-resolver';

/**
 * The single source of truth for "what can this user actually do" —
 * `PermissionGuard` calls this on every guarded request (see
 * presentation/guards/permission.guard.ts), and `GET /me/permissions`
 * exposes the same result to the user themselves. Deliberately not cached:
 * a role/override change takes effect on the very next request, not after
 * some TTL expires — see identity/README.md for the latency/correctness
 * trade-off this implies and why it was chosen anyway for this pass.
 */
@Injectable()
export class GetEffectivePermissionsUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort,
    @Inject(PERMISSION_REPOSITORY) private readonly permissions: PermissionRepositoryPort,
    @Inject(PERMISSION_OVERRIDE_REPOSITORY)
    private readonly overrides: PermissionOverrideRepositoryPort,
  ) {}

  async execute(userId: UserId): Promise<Set<string>> {
    const assignedRoleIds = await this.roles.listAssignedRoleIds(userId);
    const effectiveRoleIds = await this.roles.getEffectiveRoleIds(assignedRoleIds);
    const rolePermissionKeys = await this.permissions.listKeysForRoles(effectiveRoleIds);
    const userOverrides = await this.overrides.listForUser(userId);

    return PermissionResolver.resolve(
      rolePermissionKeys,
      userOverrides.map((override) => ({
        permissionKey: override.permissionKey,
        effect: override.effect,
      })),
    );
  }
}
