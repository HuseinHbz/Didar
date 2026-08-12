import type { UserId } from '@iecp/types';
import type { Request } from 'express';

/** What `JwtAuthGuard` attaches to `request.user` once the Bearer token
 * verifies — every other guard/decorator/controller in this module reads
 * the caller's identity from here, never by re-parsing the token. */
export interface RequestUser {
  userId: UserId;
}

export interface AuthenticatedRequest extends Request {
  user?: RequestUser;
}
