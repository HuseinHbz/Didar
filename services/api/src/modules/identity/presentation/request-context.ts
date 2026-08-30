import type { UserId } from '@iecp/types';
import type { Request } from 'express';

/** What `JwtAuthGuard` attaches to `request.user` once the caller
 * authenticates — every other guard/decorator/controller in this module
 * reads the caller's identity from here, never by re-parsing the
 * token/key. `apiKeyScopes` is present only when this request
 * authenticated via `X-API-Key` (CP-028/P2-6) rather than a Bearer
 * token — undefined for every ordinary JWT-authenticated request,
 * exactly the pre-CP-028 shape. See `AuthorizationGuard` for how a
 * present `apiKeyScopes` narrows (never widens) what the key's owner
 * could otherwise do. */
export interface RequestUser {
  userId: UserId;
  apiKeyScopes?: readonly string[];
}

export interface AuthenticatedRequest extends Request {
  user?: RequestUser;
}
