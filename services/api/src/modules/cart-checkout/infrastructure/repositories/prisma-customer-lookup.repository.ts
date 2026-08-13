import { prisma } from '@iecp/database';
import { Injectable } from '@nestjs/common';

import type {
  CustomerLookupPort,
  CustomerLookupResult,
} from '../../domain/ports/customer-lookup.port';

@Injectable()
export class PrismaCustomerLookupRepository implements CustomerLookupPort {
  async findByUserId(userId: string): Promise<CustomerLookupResult | null> {
    const customer = await prisma.customer.findUnique({
      where: { userId },
      include: { addresses: { where: { isDefault: true, deletedAt: null }, take: 1 } },
    });
    if (!customer) return null;
    const address = customer.addresses[0];
    return {
      id: customer.id,
      defaultAddress: address
        ? {
            id: address.id,
            recipientName: address.recipientName,
            phone: address.phone,
            province: address.province,
            city: address.city,
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2,
            postalCode: address.postalCode,
          }
        : null,
    };
  }
}
