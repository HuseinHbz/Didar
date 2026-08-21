import type { OtpPurpose } from '../entities/otp-request.entity';

export const OTP_NOTIFICATION_PORT = Symbol('OTP_NOTIFICATION_PORT');

/**
 * CP-017 — dispatches a real OTP code to its recipient. The one caller
 * (`RequestOtpUseCase`) treats this as fire-and-forget: a failure here
 * must never fail the OTP-issuance response, since the code itself is
 * already durably created by the time this is called (see
 * `RequestOtpUseCase.execute()`'s own try/catch around the call site).
 */
export interface OtpNotificationPort {
  sendOtpSms(props: { phone: string; code: string; purpose: OtpPurpose }): Promise<void>;
}
