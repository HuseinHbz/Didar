import {
  CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtTokenService } from '../../../identity/infrastructure/crypto/jwt-token.service';
import {
  CUSTOMER_LOOKUP_PORT,
  type CustomerLookupPort,
} from '../../domain/ports/customer-lookup.port';
import type { ActorResolvedRequest } from '../request-context';

const GUEST_TOKEN_HEADER = 'x-cart-token';

/**
 * Every cart/checkout controller is `@Public()` (the global `JwtAuthGuard`
 * rejects any request with no Bearer token, which would make guest
 * checkout impossible — the brief's own "cart must support guest and
 * authenticated customers"). This guard replaces it for exactly these
 * routes: a *present* Bearer token must still verify (a malformed/expired
 * token is a real 401, never silently downgraded to "guest"), and
 * resolves to the caller's `customer.customers` row; its *absence* is a
 * legitimate guest request, identified by `X-Cart-Token` instead
 * (ADR-007 decisions 10-11).
 */
@Injectable()
export class ActorResolverGuard implements CanActivate {
  constructor(
    private readonly jwtTokens: JwtTokenService,
    @Inject(CUSTOMER_LOOKUP_PORT) private readonly customers: CustomerLookupPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ActorResolvedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (token) {
      const verified = await this.jwtTokens.verifyAccessToken(token);
      const customer = await this.customers.findByUserId(verified.userId);
      if (!customer) {
        throw new UnauthorizedException('No customer profile exists for this account');
      }
      request.actor = { customerId: customer.id, guestToken: null };
      return true;
    }

    const guestToken = request.headers[GUEST_TOKEN_HEADER];
    request.actor = {
      customerId: null,
      guestToken: typeof guestToken === 'string' ? guestToken : null,
    };
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
