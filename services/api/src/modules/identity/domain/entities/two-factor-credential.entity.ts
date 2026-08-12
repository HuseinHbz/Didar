import { asUserId, type UserId } from '@iecp/types';

export type TwoFactorMethod = 'TOTP';

/** blueprint §5/§56 `user_two_factor` — `secretEncrypted` is ciphertext (see
 * EncryptionService); this entity never carries the raw TOTP secret. */
export class TwoFactorCredential {
  private constructor(
    public readonly userId: UserId,
    public readonly method: TwoFactorMethod,
    public readonly secretEncrypted: string,
    public readonly recoveryCodesHashed: readonly string[],
    public readonly enabled: boolean,
    public readonly verifiedAt: Date | null,
  ) {}

  static create(props: {
    userId: string;
    method: TwoFactorMethod;
    secretEncrypted: string;
    recoveryCodesHashed: readonly string[];
    enabled: boolean;
    verifiedAt?: Date | null;
  }): TwoFactorCredential {
    return new TwoFactorCredential(
      asUserId(props.userId),
      props.method,
      props.secretEncrypted,
      props.recoveryCodesHashed,
      props.enabled,
      props.verifiedAt ?? null,
    );
  }
}
