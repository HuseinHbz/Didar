import type { UserId } from '@iecp/types';
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import {
  TWO_FACTOR_REPOSITORY,
  type TwoFactorRepositoryPort,
} from '../../domain/ports/two-factor.repository.port';

import { VerifyTotpCodeHelper } from './verify-totp-code.helper';

/** Confirms `SetupTwoFactorUseCase`'s pending credential with a real code —
 * the credential only becomes `enabled` here, never at setup time. */
@Injectable()
export class EnableTwoFactorUseCase {
  constructor(
    @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactor: TwoFactorRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    private readonly verifyCode: VerifyTotpCodeHelper,
  ) {}

  async execute(userId: UserId, code: string): Promise<void> {
    const credential = await this.twoFactor.findByUserId(userId);
    if (!credential) {
      throw new BadRequestException('No pending 2FA setup — call setup first');
    }

    if (!(await this.verifyCode.verify(userId, credential, code))) {
      await this.securityEvents.record({ userId, type: 'TWO_FACTOR_FAILED' });
      throw new UnauthorizedException('Invalid code');
    }

    await this.twoFactor.enable(userId, new Date());
    await this.securityEvents.record({ userId, type: 'TWO_FACTOR_ENABLED' });
  }
}
