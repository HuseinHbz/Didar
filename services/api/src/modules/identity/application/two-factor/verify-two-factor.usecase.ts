import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import {
  TWO_FACTOR_REPOSITORY,
  type TwoFactorRepositoryPort,
} from '../../domain/ports/two-factor.repository.port';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user.repository.port';
import { JwtTokenService } from '../../infrastructure/crypto/jwt-token.service';
import { CompleteLoginService } from '../auth/complete-login.service';
import type { LoginContext, LoginOutcome } from '../auth/login-types';

import { VerifyTotpCodeHelper } from './verify-totp-code.helper';

/** Completes a login that `CompleteLoginService.afterPrimaryFactor` paused
 * with `TWO_FACTOR_REQUIRED` — the `pendingToken` from that response,
 * combined with a real TOTP/recovery code, is this use case's input. */
@Injectable()
export class VerifyTwoFactorUseCase {
  constructor(
    @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactor: TwoFactorRepositoryPort,
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    private readonly jwtTokens: JwtTokenService,
    private readonly verifyCode: VerifyTotpCodeHelper,
    private readonly completeLogin: CompleteLoginService,
  ) {}

  async execute(
    props: { pendingToken: string; code: string } & LoginContext,
  ): Promise<LoginOutcome> {
    const { userId } = await this.jwtTokens.verifyTwoFactorPendingToken(props.pendingToken);

    const [user, credential] = await Promise.all([
      this.users.findById(userId),
      this.twoFactor.findByUserId(userId),
    ]);

    if (!user || !credential?.enabled) {
      throw new UnauthorizedException('Invalid session — please log in again');
    }

    if (!(await this.verifyCode.verify(userId, credential, props.code))) {
      await this.securityEvents.record({
        userId,
        type: 'TWO_FACTOR_FAILED',
        ipAddress: props.ipAddress,
        userAgent: props.userAgent,
      });
      throw new UnauthorizedException('Invalid code');
    }

    return this.completeLogin.afterSecondFactor(user, props);
  }
}
