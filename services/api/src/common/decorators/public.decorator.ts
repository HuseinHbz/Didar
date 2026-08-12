import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of the global `JwtAuthGuard` (registered in
 * IdentityModule — see
 * services/api/src/modules/identity/identity.module.ts — but applied to
 * every route in the app, not just identity's own). Lives in `common/`,
 * not inside `modules/identity/`, because any module's routes may need it —
 * the health check is the other real user of this decorator today,
 * alongside identity's own OTP/login/refresh endpoints, none of which can
 * require a Bearer token since getting one is the whole point of calling
 * them.
 */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);
