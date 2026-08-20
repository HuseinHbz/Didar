import { prisma } from '@iecp/database';
import { Injectable } from '@nestjs/common';

import type { CustomerContextPort } from '../../domain/ports/customer-context.port';

@Injectable()
export class PrismaCustomerContextRepository implements CustomerContextPort {
  async listSegmentKeys(customerId: string | null): Promise<string[]> {
    if (!customerId) return [];
    const rows = await prisma.customerSegmentMember.findMany({
      where: { customerId },
      include: { segment: true },
    });
    return rows.map((row) => row.segment.key);
  }

  async isFirstPurchase(customerId: string | null): Promise<boolean> {
    if (!customerId) return true;
    const count = await prisma.order.count({
      where: { customerId, status: { notIn: ['CANCELLED'] } },
    });
    return count === 0;
  }
}
