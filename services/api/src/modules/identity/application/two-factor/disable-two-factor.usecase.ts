import type { UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import {
  TWO_FACTOR_REPOSITORY,
  type TwoFactorRepositoryPort,
} from '../../domain/ports/two-factor.repository.port';

import { VerifyTotpCodeHelper } from './verify-totp-code.helper';

/** Requires a valid code (TOTP or recovery) to disable — turning off 2FA is
 * itself a sensitive action, not a bare toggle. */
@Injectable()
export class DisableTwoFactorUseCase {
  constructor(
    @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactor: TwoFactorRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    private readonly verifyCode: VerifyTotpCodeHelper,
  ) {}

  async execute(userId: UserId, code: string): Promise<void> {
    const credential = await this.twoFactor.findByUserId(userId);
    if (!credential?.enabled) {
      throw new NotFoundException('2FA is not enabled');
    }

    if (!(await this.verifyCode.verify(userId, credential, code))) {
      await this.securityEvents.record({ userId, type: 'TWO_FACTOR_FAILED' });
      throw new UnauthorizedException('Invalid code');
    }

    await this.twoFactor.disable(userId);
    await this.securityEvents.record({ userId, type: 'TWO_FACTOR_DISABLED' });
  }
}
