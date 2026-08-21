import { Inject, Injectable, Logger } from '@nestjs/common';

import { OtpRequest, type OtpPurpose } from '../../domain/entities/otp-request.entity';
import {
  OTP_NOTIFICATION_PORT,
  type OtpNotificationPort,
} from '../../domain/ports/otp-notification.port';
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
 * CP-017: delivery is real (see `OTP_NOTIFICATION_PORT` ->
 * `BullmqOtpNotificationAdapter` -> `services/notification-worker`'s real
 * `SmsAdapter`) — but this use case still always returns the generated
 * code on `devOnlyCode` (gated on `IdentityConfig.exposeOtpCodeForTesting`,
 * true outside production only) rather than trusting dispatch to have
 * succeeded: notification dispatch is fire-and-forget from here (see the
 * try/catch below) precisely because a transient dispatch failure must
 * never fail — or silently lie about — the OTP-issuance response itself.
 * That keeps this class honest and testable exactly as it was pre-CP-017,
 * while still letting e2e tests and local dev complete a real OTP login
 * without depending on a real SMS provider or its network reachability.
 *
 * A repeat request for the same `(phone, purpose)` within
 * `otpNotificationCooldownSeconds` of a still-usable prior request skips
 * the SMS dispatch (never the code itself — every call still gets a
 * fresh, valid code) — see `OtpRequest.shouldSkipNotification`'s own doc
 * comment for the full reasoning and why this is safe for every existing
 * caller of this use case.
 */
@Injectable()
export class RequestOtpUseCase {
  private readonly logger = new Logger(RequestOtpUseCase.name);

  constructor(
    @Inject(OTP_REPOSITORY) private readonly otpRequests: OtpRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    @Inject(OTP_NOTIFICATION_PORT) private readonly otpNotifications: OtpNotificationPort,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    private readonly otpCode: OtpCodeService,
  ) {}

  async execute(props: {
    phone: string;
    purpose: OtpPurpose;
    ipAddress?: string | null;
  }): Promise<RequestOtpResult> {
    const now = new Date();
    const previous = await this.otpRequests.findLatest(props.phone, props.purpose);

    const { code, codeHash } = this.otpCode.generate();
    const expiresAt = new Date(now.getTime() + this.config.otpTtlSeconds * 1000);

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

    const skipDispatch = OtpRequest.shouldSkipNotification(
      previous,
      now,
      this.config.otpNotificationCooldownSeconds,
    );
    if (!skipDispatch) {
      // Fire-and-forget by design (see this class's own doc comment) — a
      // dispatch failure is logged, never thrown: the code already exists
      // and is already usable via `devOnlyCode` outside production, and a
      // production caller's HTTP response must reflect that the code was
      // *issued*, which already happened above, not that an SMS provider
      // round-trip succeeded.
      this.otpNotifications
        .sendOtpSms({ phone: props.phone, code, purpose: props.purpose })
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : 'unknown error';
          this.logger.warn(`OTP notification dispatch failed for ${props.phone}: ${reason}`);
        });
    }

    return { expiresAt, devOnlyCode: this.config.exposeOtpCodeForTesting ? code : null };
  }
}
