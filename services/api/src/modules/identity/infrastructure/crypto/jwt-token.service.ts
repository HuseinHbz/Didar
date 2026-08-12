import { randomUUID } from 'node:crypto';

import type { UserId } from '@iecp/types';
import { asUserId } from '@iecp/types';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

type TokenType = 'access' | 'two_factor_pending';

interface TokenPayload {
  sub: string; // userId
  jti: string; // unique per token — no revocation list yet, but the id exists for when one lands
  type: TokenType;
}

export interface VerifiedToken {
  userId: UserId;
  jti: string;
}

/**
 * JWTs for two purposes only, both short-lived and both distinguished by a
 * `type` claim so one can never be used as the other (a `two_factor_pending`
 * token presented as a Bearer access token is rejected, not silently
 * accepted just because the signature checks out):
 *
 *   - `access`: the normal Bearer token every authenticated request carries.
 *   - `two_factor_pending`: issued after a correct primary factor (password
 *     or OTP) when the account has 2FA enabled, in place of real tokens.
 *     Only usable at `POST /auth/2fa/verify` to complete login.
 *
 * Refresh tokens are NOT JWTs — see identity/README.md's "Why refresh
 * tokens aren't JWTs": they're opaque random strings, hashed and stored in
 * `identity.user_sessions`, which is what makes revoking one ("log out this
 * device") an actual DELETE instead of requiring a JWT blacklist.
 */
@Injectable()
export class JwtTokenService {
  constructor(private readonly jwt: JwtService) {}

  async signAccessToken(userId: UserId, ttlSeconds: number): Promise<string> {
    return this.sign(userId, 'access', ttlSeconds);
  }

  /** Deliberately short and fixed (5 min) — this token grants nothing by
   * itself except the right to attempt a 2FA code for this one login. */
  async signTwoFactorPendingToken(userId: UserId): Promise<string> {
    return this.sign(userId, 'two_factor_pending', 300);
  }

  /** Throws `UnauthorizedException` on anything invalid: expired, wrong
   * signature, tampered payload, malformed token, or (critically) the
   * wrong `type` — the guard/use case calling this never needs to
   * distinguish those cases from each other. */
  async verifyAccessToken(token: string): Promise<VerifiedToken> {
    return this.verify(token, 'access');
  }

  async verifyTwoFactorPendingToken(token: string): Promise<VerifiedToken> {
    return this.verify(token, 'two_factor_pending');
  }

  private async sign(userId: UserId, type: TokenType, ttlSeconds: number): Promise<string> {
    const payload: TokenPayload = { sub: userId, jti: randomUUID(), type };
    return this.jwt.signAsync(payload, { expiresIn: ttlSeconds });
  }

  private async verify(token: string, expectedType: TokenType): Promise<VerifiedToken> {
    try {
      const payload = await this.jwt.verifyAsync<TokenPayload>(token);
      if (payload.type !== expectedType) {
        throw new Error('token type mismatch');
      }
      return { userId: asUserId(payload.sub), jti: payload.jti };
    } catch {
      throw new UnauthorizedException(`Invalid or expired ${expectedType} token`);
    }
  }
}
