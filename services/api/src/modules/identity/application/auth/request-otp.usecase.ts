import { Inject, Injectable } from '@nestjs/common';

import type { OtpPurpose } from '../../domain/entities/otp-request.entity';
import { OTP_REPOSITORY, type OtpRepositoryPort } from '../../domain/ports/otp.repository.port';
import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import { IDENTITY_CONFIG, type IdentityConfig } from '../../identity.config';
import { OtpCodeService } from '../../infrastructure/crypto/otp-code.service';

export interface RequestOtpResult {
  expiresAt: Date;
  /** Only populated outside production (`IdentityConfig.exposeOtpCodeForTesting`)
   * — see this use case's class doc for why the code lives here at all. */
  devOnlyCode: string | null;
}

/**
 * blueprint §56: mobile OTP is the primary auth mechanism.
 *
 * Delivery is NOT wired here — `services/notification-worker` is still a
 * stub adapter set (see that service's README), so there's no real SMS
 * provider to call yet. Rather than fabricate a "delivered" response this
 * use case always returns the generated code on `devOnlyCode`, and the
 * *controller* decides whether to actually put it in the HTTP response,
 * gated on `IdentityConfig.exposeOtpCodeForTesting` (true outside
 * production). That keeps this class itself honest and testable — it never
 * pretends an SMS went out — while still letting e2e tests and local dev
 * complete a real OTP login without a real SMS provider.
 */
@Injectable()
export class RequestOtpUseCase {
  constructor(
    @Inject(OTP_REPOSITORY) private readonly otpRequests: OtpRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    private readonly otpCode: OtpCodeService,
  ) {}

  async execute(props: {
    phone: string;
    purpose: OtpPurpose;
    ipAddress?: string | null;
  }): Promise<RequestOtpResult> {
    const { code, codeHash } = this.otpCode.generate();
    const expiresAt = new Date(Date.now() + this.config.otpTtlSeconds * 1000);

    await this.otpRequests.create({
      phone: props.phone,
      codeHash,
      purpose: props.purpose,
      expiresAt,
    });
    await this.securityEvents.record({
      type: 'OTP_REQUESTED',
      ipAddress: props.ipAddress,
      metadata: { phone: props.phone, purpose: props.purpose },
    });

    return { expiresAt, devOnlyCode: this.config.exposeOtpCodeForTesting ? code : null };
  }
}
