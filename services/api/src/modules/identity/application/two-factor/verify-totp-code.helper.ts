import type { UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import type { TwoFactorCredential } from '../../domain/entities/two-factor-credential.entity';
import {
  TWO_FACTOR_REPOSITORY,
  type TwoFactorRepositoryPort,
} from '../../domain/ports/two-factor.repository.port';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { sha256Hex } from '../../infrastructure/crypto/hash.util';
import { TotpService } from '../../infrastructure/crypto/totp.service';

/**
 * Shared by every use case that needs to check a caller-supplied code
 * against a user's TOTP credential (enable/disable/login-verify) — decrypts
 * the secret, tries a live TOTP code first, then falls back to a recovery
 * code. Not itself a use case (nothing calls it from a controller).
 */
@Injectable()
export class VerifyTotpCodeHelper {
  constructor(
    @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactorRepo: TwoFactorRepositoryPort,
    private readonly totp: TotpService,
    private readonly encryption: EncryptionService,
  ) {}

  async verify(userId: UserId, credential: TwoFactorCredential, code: string): Promise<boolean> {
    const secret = this.encryption.decrypt(credential.secretEncrypted);
    if (await this.totp.verifyCode(secret, code)) {
      return true;
    }
    return this.twoFactorRepo.consumeRecoveryCode(userId, sha256Hex(code));
  }
}
