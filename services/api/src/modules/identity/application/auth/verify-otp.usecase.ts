import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import type { OtpPurpose } from '../../domain/entities/otp-request.entity';
import { OTP_REPOSITORY, type OtpRepositoryPort } from '../../domain/ports/otp.repository.port';
import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user.repository.port';
import { OtpCodeService } from '../../infrastructure/crypto/otp-code.service';

import { CompleteLoginService } from './complete-login.service';
import type { LoginContext, LoginOutcome } from './login-types';

@Injectable()
export class VerifyOtpUseCase {
  constructor(
    @Inject(OTP_REPOSITORY) private readonly otpRequests: OtpRepositoryPort,
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    private readonly otpCode: OtpCodeService,
    private readonly completeLogin: CompleteLoginService,
  ) {}

  async execute(
    props: { phone: string; purpose: OtpPurpose; code: string } & LoginContext,
  ): Promise<LoginOutcome> {
    const now = new Date();
    const request = await this.otpRequests.findLatest(props.phone, props.purpose);

    if (!request?.isUsable(now)) {
      await this.recordFailure(props.phone, props.ipAddress);
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (this.otpCode.hash(props.code) !== request.codeHash) {
      await this.otpRequests.incrementAttempts(request.id);
      await this.recordFailure(props.phone, props.ipAddress);
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.otpRequests.consume(request.id, now);
    await this.securityEvents.record({
      type: 'OTP_VERIFIED',
      ipAddress: props.ipAddress,
      metadata: { phone: props.phone, purpose: props.purpose },
    });

    const user =
      (await this.users.findByPhone(props.phone)) ??
      (await this.users.createFromVerifiedPhone(props.phone));

    return this.completeLogin.afterPrimaryFactor(user, props);
  }

  private async recordFailure(phone: string, ipAddress?: string | null): Promise<void> {
    await this.securityEvents.record({ type: 'OTP_FAILED', ipAddress, metadata: { phone } });
  }
}
