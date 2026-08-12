import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/** Gates a route on one permission key (e.g. `"identity.roles.manage"`) —
 * checked by `AuthorizationGuard` against the caller's resolved effective
 * permissions (role inheritance + per-user overrides, deny-wins). See
 * domain/services/permission-resolver.ts. */
export const RequirePermission = (permissionKey: string): ReturnType<typeof SetMetadata> =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permissionKey);
