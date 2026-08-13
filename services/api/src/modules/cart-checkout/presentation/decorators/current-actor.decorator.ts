import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

import type { ActorResolvedRequest, CartCheckoutActor } from '../request-context';

/** Reads the actor `ActorResolverGuard` already resolved onto the
 * request — same "guard writes, decorator reads" shape identity's own
 * `CurrentUserId` decorator uses. Throwing if `request.actor` is missing
 * is a wiring-bug signal (a route using this decorator without
 * `ActorResolverGuard` applied), never a runtime auth failure — those are
 * 401s the guard itself throws. */
export const CurrentActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CartCheckoutActor => {
    const request = ctx.switchToHttp().getRequest<ActorResolvedRequest>();
    if (!request.actor) {
      throw new InternalServerErrorException('ActorResolverGuard did not run for this route');
    }
    return request.actor;
  },
);
