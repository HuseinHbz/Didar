import type { PermissionEffect } from '@iecp/types';

/**
 * Pure business logic: no repository, no Prisma, no NestJS DI — a plain
 * class over plain data, unit-testable without a database or a mock. Every
 * piece of I/O this needs (walking the role-inheritance tree, listing
 * permission keys, listing a user's overrides) happens beforehand, in
 * infrastructure; this class only combines the results.
 *
 * blueprint §53's two rules, both enforced here:
 *   1. A role's effective permissions include everything its ancestors
 *      grant (role inheritance) — the caller passes the already-flattened
 *      role-id set (self + ancestors; see RoleRepositoryPort.getEffectiveRoleIds),
 *      this class just needs the permission keys those roles grant.
 *   2. A per-user override always wins over whatever the role set grants:
 *      DENY removes a permission the roles would otherwise allow; ALLOW
 *      grants one no assigned role does.
 */
export class PermissionResolver {
  /**
   * @param rolePermissionKeys Permission keys granted by ANY of the user's
   *   effective (self + inherited) roles.
   * @param overrides This user's `UserPermissionOverride` rows, as
   *   `{ permissionKey, effect }` pairs.
   */
  static resolve(
    rolePermissionKeys: readonly string[],
    overrides: readonly { permissionKey: string; effect: PermissionEffect }[],
  ): Set<string> {
    const resolved = new Set(rolePermissionKeys);

    // ALLOW overrides apply first, DENY second, so a DENY always wins even
    // if (by data-entry mistake) both exist for the same permission on the
    // same user — deny-wins is the safer failure mode for an access-control
    // conflict.
    for (const override of overrides) {
      if (override.effect === 'ALLOW') {
        resolved.add(override.permissionKey);
      }
    }
    for (const override of overrides) {
      if (override.effect === 'DENY') {
        resolved.delete(override.permissionKey);
      }
    }

    return resolved;
  }

  static has(effectivePermissions: ReadonlySet<string>, permissionKey: string): boolean {
    return effectivePermissions.has(permissionKey);
  }

  /** blueprint's "module access control" — true if the user holds at least
   * one permission whose `module` segment (the part before the first '.')
   * matches. Permission keys are `module.action`, so this is a prefix check
   * against `${module}.`. */
  static hasModuleAccess(effectivePermissions: ReadonlySet<string>, module: string): boolean {
    const prefix = `${module}.`;
    for (const key of effectivePermissions) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }
}
