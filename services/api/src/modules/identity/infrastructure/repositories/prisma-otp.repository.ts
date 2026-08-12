import { prisma, type OtpRequest as PrismaOtpRequest } from '@iecp/database';
import { Injectable } from '@nestjs/common';

import { OtpRequest, type OtpPurpose } from '../../domain/entities/otp-request.entity';
import type { OtpRepositoryPort } from '../../domain/ports/otp.repository.port';

@Injectable()
export class PrismaOtpRepository implements OtpRepositoryPort {
  async create(props: {
    phone: string;
    codeHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
  }): Promise<OtpRequest> {
    const row = await prisma.otpRequest.create({
      data: {
        phone: props.phone,
        codeHash: props.codeHash,
        purpose: props.purpose,
        expiresAt: props.expiresAt,
      },
    });
    return toDomain(row);
  }

  async findLatest(phone: string, purpose: OtpPurpose): Promise<OtpRequest | null> {
    const row = await prisma.otpRequest.findFirst({
      where: { phone, purpose },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async incrementAttempts(id: string): Promise<void> {
    await prisma.otpRequest.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }

  async consume(id: string, at: Date): Promise<void> {
    await prisma.otpRequest.update({ where: { id }, data: { consumedAt: at } });
  }
}

function toDomain(row: PrismaOtpRequest): OtpRequest {
  return OtpRequest.create({
    id: row.id,
    phone: row.phone,
    codeHash: row.codeHash,
    purpose: row.purpose as OtpPurpose,
    attempts: row.attempts,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  });
}
