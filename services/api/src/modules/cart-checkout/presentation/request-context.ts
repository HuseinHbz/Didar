import type { Request } from 'express';

/** What `ActorResolverGuard` attaches to `request.actor` — resolved once
 * per request, read by `@CurrentActor()` everywhere else. Exactly one of
 * `customerId`/`guestToken` is non-null (a request is either an
 * authenticated customer or a guest, never both — ADR-007 decision 10). */
export interface CartCheckoutActor {
  customerId: string | null;
  guestToken: string | null;
}

export interface ActorResolvedRequest extends Request {
  actor?: CartCheckoutActor;
}
