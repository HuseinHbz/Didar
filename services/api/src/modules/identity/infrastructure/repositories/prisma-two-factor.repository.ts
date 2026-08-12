import { prisma, type TwoFactorCredential as PrismaTwoFactor } from '@iecp/database';
import type { UserId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import {
  TwoFactorCredential,
  type TwoFactorMethod,
} from '../../domain/entities/two-factor-credential.entity';
import type { TwoFactorRepositoryPort } from '../../domain/ports/two-factor.repository.port';

@Injectable()
export class PrismaTwoFactorRepository implements TwoFactorRepositoryPort {
  async findByUserId(userId: UserId): Promise<TwoFactorCredential | null> {
    const row = await prisma.twoFactorCredential.findUnique({ where: { userId } });
    return row ? toDomain(row) : null;
  }

  async upsertPending(props: {
    userId: UserId;
    method: TwoFactorMethod;
    secretEncrypted: string;
    recoveryCodesHashed: readonly string[];
  }): Promise<TwoFactorCredential> {
    const row = await prisma.twoFactorCredential.upsert({
      where: { userId: props.userId },
      update: {
        method: props.method,
        secretEncrypted: props.secretEncrypted,
        recoveryCodesHashed: [...props.recoveryCodesHashed],
        enabled: false,
        verifiedAt: null,
      },
      create: {
        userId: props.userId,
        method: props.method,
        secretEncrypted: props.secretEncrypted,
        recoveryCodesHashed: [...props.recoveryCodesHashed],
      },
    });
    return toDomain(row);
  }

  async enable(userId: UserId, verifiedAt: Date): Promise<void> {
    await prisma.twoFactorCredential.update({
      where: { userId },
      data: { enabled: true, verifiedAt },
    });
  }

  async disable(userId: UserId): Promise<void> {
    // deleteMany (not delete) — matches zero rows without throwing, so
    // disabling something that isn't enabled is a no-op, not an error.
    await prisma.twoFactorCredential.deleteMany({ where: { userId } });
  }

  async consumeRecoveryCode(userId: UserId, codeHash: string): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const row = await tx.twoFactorCredential.findUnique({ where: { userId } });
      if (!row?.recoveryCodesHashed.includes(codeHash)) {
        return false;
      }
      await tx.twoFactorCredential.update({
        where: { userId },
        data: { recoveryCodesHashed: row.recoveryCodesHashed.filter((hash) => hash !== codeHash) },
      });
      return true;
    });
  }
}

function toDomain(row: PrismaTwoFactor): TwoFactorCredential {
  return TwoFactorCredential.create({
    userId: row.userId,
    method: row.method,
    secretEncrypted: row.secretEncrypted,
    recoveryCodesHashed: row.recoveryCodesHashed,
    enabled: row.enabled,
    verifiedAt: row.verifiedAt,
  });
}
