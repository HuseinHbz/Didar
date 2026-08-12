import { SetMetadata } from '@nestjs/common';

export const REQUIRED_MODULE_KEY = 'requiredModule';

/** blueprint's "module access control" — coarser than `@RequirePermission`:
 * grants access if the caller holds ANY permission in the given module,
 * regardless of which specific action. Useful for a route that just needs
 * "can this user see the Commerce section at all," not a specific action
 * within it. See `PermissionResolver.hasModuleAccess`. */
export const RequireModule = (module: string): ReturnType<typeof SetMetadata> =>
  SetMetadata(REQUIRED_MODULE_KEY, module);
