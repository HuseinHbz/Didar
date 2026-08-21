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

  /**
   * CP-017 — whether issuing a fresh code for `(phone, purpose)` should
   * also trigger a real SMS dispatch, given `previous` is the most recent
   * prior request for the same pair (or `null`). This throttles SMS
   * *dispatch* only, never code *issuance* — `RequestOtpUseCase` always
   * creates a new `OtpRequest` and returns a fresh code regardless of
   * this method's answer (a code's hash is never retained in a form that
   * could be safely re-disclosed on a "reuse" path, so throttling
   * issuance itself isn't an option — see the class doc's own reasoning
   * and docs/adr/ADR-014-real-notification-delivery.md).
   *
   * Skips (returns `true`, meaning "don't dispatch") only when `previous`
   * is still genuinely usable — not consumed, not expired, not
   * attempts-exhausted — AND was created within `cooldownSeconds`: the
   * recipient most likely already has a valid code in hand, so a second
   * real SMS within that window is dispatch-cost abuse, not a legitimate
   * need. A `previous` that's already consumed (the normal request ->
   * verify -> consume flow every login completes) or expired never skips
   * — this is what keeps rapid sequential logins (e.g. this repo's own
   * e2e suite, which never leaves an OTP unconsumed before requesting the
   * next one for the same phone) unaffected.
   */
  static shouldSkipNotification(
    previous: OtpRequest | null,
    now: Date,
    cooldownSeconds: number,
  ): boolean {
    if (previous === null) return false;
    if (!previous.isUsable(now)) return false;
    const ageMs = now.getTime() - previous.createdAt.getTime();
    return ageMs < cooldownSeconds * 1000;
  }
}
