import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

import type { AuthenticatedRequest } from '../request-context';

/** The caller's own userId, from the verified access token — never from a
 * request body/param, so a handler can't be tricked into acting on behalf
 * of someone else just because a field happens to be named `userId`. */
export const CurrentUserId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    // Only reachable if this decorator is used on a route that isn't
    // behind JwtAuthGuard — a wiring bug, not a runtime auth failure.
    throw new UnauthorizedException('No authenticated user on this request');
  }
  return request.user.userId;
});
