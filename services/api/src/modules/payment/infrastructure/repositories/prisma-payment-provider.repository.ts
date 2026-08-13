import { prisma } from '@iecp/database';
import { Injectable } from '@nestjs/common';

import type { PaymentProvider } from '../../domain/entities/payment-provider.entity';
import type { PaymentProviderRepositoryPort } from '../../domain/ports/payment-provider.repository.port';
import { paymentProviderToDomain } from '../payment.mapper';

@Injectable()
export class PrismaPaymentProviderRepository implements PaymentProviderRepositoryPort {
  async findById(id: string): Promise<PaymentProvider | null> {
    const row = await prisma.paymentProvider.findUnique({ where: { id } });
    return row ? paymentProviderToDomain(row) : null;
  }

  async findByCode(code: string): Promise<PaymentProvider | null> {
    const row = await prisma.paymentProvider.findUnique({ where: { code } });
    return row ? paymentProviderToDomain(row) : null;
  }

  async listActive(): Promise<PaymentProvider[]> {
    const rows = await prisma.paymentProvider.findMany({ where: { isActive: true } });
    return rows.map(paymentProviderToDomain);
  }

  async recordHealthCheck(
    id: string,
    props: { ok: boolean; checkedAt: Date },
  ): Promise<PaymentProvider> {
    const row = await prisma.paymentProvider.update({
      where: { id },
      data: { lastHealthCheckOk: props.ok, lastHealthCheckAt: props.checkedAt },
    });
    return paymentProviderToDomain(row);
  }
}
