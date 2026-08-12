import { Inject, Injectable } from '@nestjs/common';

import type { User } from '../../domain/entities/user.entity';
import {
  DEVICE_REPOSITORY,
  type DeviceRepositoryPort,
} from '../../domain/ports/device.repository.port';
import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import {
  SESSION_REPOSITORY,
  type SessionRepositoryPort,
} from '../../domain/ports/session.repository.port';
import {
  TWO_FACTOR_REPOSITORY,
  type TwoFactorRepositoryPort,
} from '../../domain/ports/two-factor.repository.port';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user.repository.port';
import { IDENTITY_CONFIG, type IdentityConfig } from '../../identity.config';
import { randomToken, sha256Hex } from '../../infrastructure/crypto/hash.util';
import { JwtTokenService } from '../../infrastructure/crypto/jwt-token.service';

import type { LoginContext, LoginOutcome } from './login-types';

/**
 * Shared by every use case that ends in "the user is now logged in":
 * OTP verification, password login, and 2FA verification all call this
 * once their own factor(s) have already succeeded. Not a use case itself
 * (no controller calls it directly) — it's the common tail of three of them.
 */
@Injectable()
export class CompleteLoginService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(DEVICE_REPOSITORY) private readonly devices: DeviceRepositoryPort,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactor: TwoFactorRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    private readonly jwtTokens: JwtTokenService,
  ) {}

  /** Called once the primary factor (password or OTP) has already been
   * verified by the caller — this method does not re-check credentials. */
  async afterPrimaryFactor(user: User, context: LoginContext): Promise<LoginOutcome> {
    const credential = await this.twoFactor.findByUserId(user.id);
    if (credential?.enabled) {
      const pendingToken = await this.jwtTokens.signTwoFactorPendingToken(user.id);
      return { kind: 'TWO_FACTOR_REQUIRED', pendingToken };
    }
    return this.issueTokens(user, context);
  }

  /** Called by VerifyTwoFactorUseCase once the second factor has also
   * succeeded — always ends in real tokens, never another 2FA prompt. */
  async afterSecondFactor(user: User, context: LoginContext): Promise<LoginOutcome> {
    return this.issueTokens(user, context);
  }

  private async issueTokens(user: User, context: LoginContext): Promise<LoginOutcome> {
    const now = new Date();

    const device = context.deviceFingerprint
      ? await this.devices.findOrTouch({
          userId: user.id,
          fingerprint: context.deviceFingerprint,
          platform: context.devicePlatform,
          now,
        })
      : null;

    const rawRefreshToken = randomToken(32);
    const expiresAt = new Date(now.getTime() + this.config.jwtRefreshTtlSeconds * 1000);
    await this.sessions.create({
      userId: user.id,
      deviceId: device?.id,
      refreshTokenHash: sha256Hex(rawRefreshToken),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      expiresAt,
    });

    const accessToken = await this.jwtTokens.signAccessToken(
      user.id,
      this.config.jwtAccessTtlSeconds,
    );

    await this.users.markLoggedIn(user.id, now);
    await this.securityEvents.record({
      userId: user.id,
      type: 'LOGIN_SUCCESS',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { kind: 'AUTHENTICATED', accessToken, refreshToken: rawRefreshToken, user };
  }
}
