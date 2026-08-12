import type { OtpPurpose, OtpRequest } from '../entities/otp-request.entity';

export const OTP_REPOSITORY = Symbol('OTP_REPOSITORY');

export interface OtpRepositoryPort {
  create(props: {
    phone: string;
    codeHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
  }): Promise<OtpRequest>;
  /** Most recent request for `(phone, purpose)`, regardless of whether it's
   * still usable — the use case decides usability via `OtpRequest.isUsable`. */
  findLatest(phone: string, purpose: OtpPurpose): Promise<OtpRequest | null>;
  incrementAttempts(id: string): Promise<void>;
  consume(id: string, at: Date): Promise<void>;
}
