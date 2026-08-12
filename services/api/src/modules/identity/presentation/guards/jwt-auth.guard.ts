import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import { JwtTokenService } from '../../infrastructure/crypto/jwt-token.service';
import type { AuthenticatedRequest } from '../request-context';

/**
 * Registered as a global guard (APP_GUARD in identity.module.ts) — every
 * route requires a valid Bearer access token unless marked `@Public()`.
 * This is the enforcement point for "authentication," full stop;
 * authorization (permissions/module access) is `AuthorizationGuard`'s job,
 * layered on top, not this guard's.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtTokens: JwtTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const verified = await this.jwtTokens.verifyAccessToken(token);
    request.user = { userId: verified.userId };
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
