export type OtpPurpose = 'LOGIN' | 'REGISTER' | 'RESET_PASSWORD';

/** blueprint §56 — mobile OTP, the primary auth mechanism. Append-only: a
 * consumed/expired code is never edited, only superseded by a new request. */
export class OtpRequest {
  private constructor(
    public readonly id: string,
    public readonly phone: string,
    public readonly codeHash: string,
    public readonly purpose: OtpPurpose,
    public readonly attempts: number,
    public readonly expiresAt: Date,
    public readonly consumedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    phone: string;
    codeHash: string;
    purpose: OtpPurpose;
    attempts: number;
    expiresAt: Date;
    consumedAt?: Date | null;
    createdAt: Date;
  }): OtpRequest {
    return new OtpRequest(
      props.id,
      props.phone,
      props.codeHash,
      props.purpose,
      props.attempts,
      props.expiresAt,
      props.consumedAt ?? null,
      props.createdAt,
    );
  }

  /** blueprint has no explicit attempt cap, but "6-digit code with no cap"
   * is an open brute-force door — 5 tries per issued code is the guard. */
  static readonly MAX_ATTEMPTS = 5;

  isUsable(now: Date): boolean {
    return (
      this.consumedAt === null && this.expiresAt > now && this.attempts < OtpRequest.MAX_ATTEMPTS
    );
  }
}
