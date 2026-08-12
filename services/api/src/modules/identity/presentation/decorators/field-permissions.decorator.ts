import { SetMetadata } from '@nestjs/common';

export const FIELD_PERMISSIONS_KEY = 'fieldPermissions';

export interface FieldPermissionRule {
  /** A top-level property name on the response DTO. Nested/dot-path fields
   * are deliberately not supported — see field-permission.interceptor.ts's
   * doc for why that's the honest scope of this pass, not an oversight. */
  field: string;
  permissionKey: string;
}

/**
 * blueprint's "field level permission" — hides specific response fields
 * from callers who lack the given permission, without denying the request
 * outright (contrast with `@RequirePermission`, which blocks the whole
 * route). Paired with `FieldPermissionInterceptor`, which does the actual
 * stripping. See identity/README.md for the one concrete case this ships
 * with (`GET /users/:id`'s `phone`/`email`) and what a fully generalized
 * version of this mechanism would still need.
 */
export const FieldPermissions = (rules: FieldPermissionRule[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(FIELD_PERMISSIONS_KEY, rules);
