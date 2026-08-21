export const IDENTITY_CONFIG = Symbol('IDENTITY_CONFIG');

export interface IdentityConfig {
  jwtAccessTtlSeconds: number;
  jwtRefreshTtlSeconds: number;
  otpTtlSeconds: number;
  /** Only ever true outside production — gates whether an OTP response is
   * allowed to echo the raw code (see RequestOtpUseCase). */
  exposeOtpCodeForTesting: boolean;
  /** CP-017 — see OtpRequest.shouldSkipNotification's own doc comment. */
  otpNotificationCooldownSeconds: number;
}
