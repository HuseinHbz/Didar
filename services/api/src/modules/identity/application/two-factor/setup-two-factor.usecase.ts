import type { UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  TWO_FACTOR_REPOSITORY,
  type TwoFactorRepositoryPort,
} from '../../domain/ports/two-factor.repository.port';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user.repository.port';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { randomAlphanumericCode, sha256Hex } from '../../infrastructure/crypto/hash.util';
import { TotpService } from '../../infrastructure/crypto/totp.service';

const RECOVERY_CODE_COUNT = 8;
const ISSUER = 'IECP';

export interface TwoFactorSetupResult {
  provisioningUri: string;
  /** Shown exactly once — only the hashes are ever persisted. */
  recoveryCodes: string[];
}

/** Starts (or restarts) 2FA enrollment — `enabled: false` until
 * `EnableTwoFactorUseCase` confirms the caller can actually produce a
 * valid code, so a botched scan never locks anyone out of their account. */
@Injectable()
export class SetupTwoFactorUseCase {
  constructor(
    @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactor: TwoFactorRepositoryPort,
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    private readonly totp: TotpService,
    private readonly encryption: EncryptionService,
  ) {}

  async execute(userId: UserId): Promise<TwoFactorSetupResult> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const secret = this.totp.generateSecret();
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomAlphanumericCode(),
    );

    await this.twoFactor.upsertPending({
      userId,
      method: 'TOTP',
      secretEncrypted: this.encryption.encrypt(secret),
      recoveryCodesHashed: recoveryCodes.map(sha256Hex),
    });

    const provisioningUri = this.totp.provisioningUri({
      secret,
      accountLabel: user.email ?? user.phone,
      issuer: ISSUER,
    });

    return { provisioningUri, recoveryCodes };
  }
}
