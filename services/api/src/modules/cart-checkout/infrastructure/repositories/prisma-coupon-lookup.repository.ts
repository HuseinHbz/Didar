import { prisma } from '@iecp/database';
import { Injectable } from '@nestjs/common';

import type { CouponLookupPort, CouponLookupResult } from '../../domain/ports/coupon-lookup.port';

@Injectable()
export class PrismaCouponLookupRepository implements CouponLookupPort {
  async findByCode(code: string): Promise<CouponLookupResult | null> {
    const row = await prisma.coupon.findUnique({ where: { code } });
    if (!row || row.deletedAt) return null;
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      minOrderAmount: row.minOrderAmount,
      maxDiscountAmount: row.maxDiscountAmount,
      usageLimit: row.usageLimit,
      perUserLimit: row.perUserLimit,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      isActive: row.isActive,
    };
  }

  async countRedemptionsByCustomer(couponId: string, customerId: string | null): Promise<number> {
    if (!customerId) return 0;
    return prisma.couponRedemption.count({ where: { couponId, customerId } });
  }
}
