import { asUserId, type UserId } from '@iecp/types';
import {
  CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import {
  API_KEY_REPOSITORY,
  type ApiKeyRepositoryPort,
} from '../../domain/ports/api-key.repository.port';
import { ApiKeyGeneratorService } from '../../infrastructure/crypto/api-key-generator.service';
import { JwtTokenService } from '../../infrastructure/crypto/jwt-token.service';
import type { AuthenticatedRequest } from '../request-context';

const API_KEY_HEADER = 'x-api-key';

/**
 * Registered as a global guard (APP_GUARD in identity.module.ts) — every
 * route requires a valid Bearer access token or a valid `X-API-Key` header
 * unless marked `@Public()`. This is the enforcement point for
 * "authentication," full stop; authorization (permissions/module access)
 * is `AuthorizationGuard`'s job, layered on top, not this guard's.
 *
 * CP-028 (P2-6) — API-key authentication. Issuance/revocation
 * (`/me/api-keys`) has been real since Phase 004; nothing verified a key
 * on an inbound request until this pass — see `docs/security/README.md`'s
 * former "Not yet" entry for the exact gap this closes. Deliberately
 * scoped: a key authenticates *as its owner*, inheriting exactly that
 * owner's RBAC permissions (never a separate machine-scoped grant this
 * pass doesn't invent) — `AuthorizationGuard` then further narrows what a
 * key-authenticated request may do to the key's own `scopes`, on top of,
 * never instead of, the owner's real RBAC. An owner-less key (`ownerId`
 * null — the schema allows it, but the only thing that ever creates a key
 * today, `CreateApiKeyUseCase`, always sets one) is rejected rather than
 * silently treated as some kind of anonymous principal — a genuinely
 * different feature (a standalone machine credential with its own
 * permission grant, not "on behalf of a user") this pass does not build.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtTokens: JwtTokenService,
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepositoryPort,
    private readonly apiKeyGenerator: ApiKeyGeneratorService,
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

    const apiKeyHeader = request.headers[API_KEY_HEADER];
    const rawApiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    if (rawApiKey) {
      request.user = await this.authenticateApiKey(rawApiKey);
      return true;
    }

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token or API key');
    }

    const verified = await this.jwtTokens.verifyAccessToken(token);
    request.user = { userId: verified.userId };
    return true;
  }

  private async authenticateApiKey(
    rawKey: string,
  ): Promise<{ userId: UserId; apiKeyScopes: readonly string[] }> {
    // Hashed and looked up the same way `RevokeApiKeyUseCase` (etc.)
    // already treats every key — the raw value itself is never logged,
    // persisted, or echoed back anywhere past this point.
    const keyHash = this.apiKeyGenerator.hash(rawKey);
    const record = await this.apiKeys.findByHash(keyHash);
    if (!record?.isActive) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }
    if (record.ownerId === null) {
      // See this class's own doc comment — a real gap for a future,
      // separate feature, not silently faked here.
      throw new UnauthorizedException('This API key has no owner and cannot authenticate yet');
    }

    await this.apiKeys.touchLastUsed(record.id, new Date());

    return {
      userId: asUserId(record.ownerId),
      apiKeyScopes: record.scopes,
    };
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
