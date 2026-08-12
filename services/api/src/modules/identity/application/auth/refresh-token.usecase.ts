import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import {
  SESSION_REPOSITORY,
  type SessionRepositoryPort,
} from '../../domain/ports/session.repository.port';
import { IDENTITY_CONFIG, type IdentityConfig } from '../../identity.config';
import { randomToken, sha256Hex } from '../../infrastructure/crypto/hash.util';
import { JwtTokenService } from '../../infrastructure/crypto/jwt-token.service';

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Refresh token ROTATION (blueprint §55's "Refresh Tokens" / "JWT
 * Rotation"): every refresh consumes the presented token and issues a
 * brand new one — the old session row is revoked, a new one created with
 * the same device/user-agent/IP lineage. A stolen-then-reused refresh
 * token is single-use: whoever redeems it first "wins", and the original
 * owner's next refresh attempt fails because their session is already
 * revoked — which is itself worth surfacing (a real system would alert on
 * this), though that alerting is out of scope for this pass.
 */
@Injectable()
export class RefreshTokenUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    private readonly jwtTokens: JwtTokenService,
  ) {}

  async execute(props: {
    refreshToken: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<RefreshedTokens> {
    const now = new Date();
    const session = await this.sessions.findByRefreshTokenHash(sha256Hex(props.refreshToken));

    if (!session?.isActive(now)) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.sessions.revoke(session.id, now);

    const rawRefreshToken = randomToken(32);
    const expiresAt = new Date(now.getTime() + this.config.jwtRefreshTtlSeconds * 1000);
    await this.sessions.create({
      userId: session.userId,
      deviceId: session.deviceId,
      refreshTokenHash: sha256Hex(rawRefreshToken),
      userAgent: props.userAgent ?? session.userAgent,
      ipAddress: props.ipAddress ?? session.ipAddress,
      expiresAt,
    });

    await this.securityEvents.record({
      userId: session.userId,
      type: 'SESSION_REFRESHED',
      ipAddress: props.ipAddress,
      userAgent: props.userAgent,
    });

    const accessToken = await this.jwtTokens.signAccessToken(
      session.userId,
      this.config.jwtAccessTtlSeconds,
    );
    return { accessToken, refreshToken: rawRefreshToken };
  }
}
