import type { UserId } from '@iecp/types';

import type {
  TwoFactorCredential,
  TwoFactorMethod,
} from '../entities/two-factor-credential.entity';

export const TWO_FACTOR_REPOSITORY = Symbol('TWO_FACTOR_REPOSITORY');

export interface TwoFactorRepositoryPort {
  findByUserId(userId: UserId): Promise<TwoFactorCredential | null>;
  /** Creates or replaces the (not-yet-enabled) credential — a fresh
   * `setup` call always starts over, it doesn't merge with a prior one. */
  upsertPending(props: {
    userId: UserId;
    method: TwoFactorMethod;
    secretEncrypted: string;
    recoveryCodesHashed: readonly string[];
  }): Promise<TwoFactorCredential>;
  enable(userId: UserId, verifiedAt: Date): Promise<void>;
  disable(userId: UserId): Promise<void>;
  /** Atomically removes `codeHash` from the stored set if present, returning
   * whether it was — a recovery code is single-use. */
  consumeRecoveryCode(userId: UserId, codeHash: string): Promise<boolean>;
}
