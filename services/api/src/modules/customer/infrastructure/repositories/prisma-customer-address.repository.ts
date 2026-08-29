import { randomUUID } from 'node:crypto';

import { prisma } from '@iecp/database';
import type { CustomerAddressId, CustomerId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { CustomerAddress } from '../../domain/entities/customer-address.entity';
import type { CustomerAddressRepositoryPort } from '../../domain/ports/customer-address.repository.port';

interface AddressRow {
  id: string;
  customerId: string;
  label: string | null;
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaCustomerAddressRepository implements CustomerAddressRepositoryPort {
  async listByCustomer(customerId: CustomerId): Promise<CustomerAddress[]> {
    const rows = await prisma.customerAddress.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  async findById(id: CustomerAddressId): Promise<CustomerAddress | null> {
    const row = await prisma.customerAddress.findFirst({ where: { id, deletedAt: null } });
    return row ? this.toDomain(row) : null;
  }

  /** The caller's `isDefault` flag is only advisory: the *first* address
   * a customer ever creates is always default regardless of what was
   * asked (a customer must never have zero default addresses once they
   * have at least one), and asking for default on a later address
   * atomically clears every other default first — both inside the same
   * transaction, backstopped by `customer_addresses_one_default_per_customer`
   * against a concurrent second `create`/`setDefault` racing this one. */
  async create(props: {
    customerId: CustomerId;
    label: string | null;
    recipientName: string;
    phone: string;
    province: string;
    city: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string | null;
    isDefault: boolean;
  }): Promise<CustomerAddress> {
    const row = await prisma.$transaction(async (tx) => {
      const existingCount = await tx.customerAddress.count({
        where: { customerId: props.customerId, deletedAt: null },
      });
      const isDefault = existingCount === 0 ? true : props.isDefault;

      if (isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId: props.customerId, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.customerAddress.create({
        data: {
          id: randomUUID(),
          customerId: props.customerId,
          label: props.label,
          recipientName: props.recipientName,
          phone: props.phone,
          province: props.province,
          city: props.city,
          addressLine1: props.addressLine1,
          addressLine2: props.addressLine2,
          postalCode: props.postalCode,
          isDefault,
        },
      });
    });
    return this.toDomain(row);
  }

  async update(
    id: CustomerAddressId,
    props: Partial<{
      label: string | null;
      recipientName: string;
      phone: string;
      province: string;
      city: string;
      addressLine1: string;
      addressLine2: string | null;
      postalCode: string | null;
    }>,
  ): Promise<CustomerAddress> {
    const row = await prisma.customerAddress.update({
      where: { id },
      data: {
        label: props.label,
        recipientName: props.recipientName,
        phone: props.phone,
        province: props.province,
        city: props.city,
        addressLine1: props.addressLine1,
        addressLine2: props.addressLine2,
        postalCode: props.postalCode,
      },
    });
    return this.toDomain(row);
  }

  /** Soft-deletes `id`; if it was the default, promotes the customer's
   * next-most-recently-created remaining address to default in the same
   * transaction — deterministic, and never leaves a customer with
   * addresses but no default. */
  async softDelete(id: CustomerAddressId): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Must read the pre-update state — `update()`'s own return value
      // reflects the row *after* this statement, which already has
      // `isDefault: false` (we just set it), so checking `deleted.isDefault`
      // there would always be false and this would never promote anything.
      const existing = await tx.customerAddress.findUniqueOrThrow({ where: { id } });
      const wasDefault = existing.isDefault;

      const deleted = await tx.customerAddress.update({
        where: { id },
        data: { deletedAt: new Date(), isDefault: false },
      });

      if (!wasDefault) return;

      const promoted = await tx.customerAddress.findFirst({
        where: { customerId: deleted.customerId, deletedAt: null, id: { not: id } },
        orderBy: { createdAt: 'desc' },
      });
      if (promoted) {
        await tx.customerAddress.update({ where: { id: promoted.id }, data: { isDefault: true } });
      }
    });
  }

  /** Atomically makes `id` the sole default for `customerId` — clears
   * every other default first, in the same transaction, backstopped by
   * `customer_addresses_one_default_per_customer` against a concurrent
   * caller doing the same for a different address. */
  async setDefault(id: CustomerAddressId, customerId: CustomerId): Promise<CustomerAddress> {
    const row = await prisma.$transaction(async (tx) => {
      await tx.customerAddress.updateMany({
        where: { customerId, deletedAt: null, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
      return tx.customerAddress.update({ where: { id }, data: { isDefault: true } });
    });
    return this.toDomain(row);
  }

  private toDomain(row: AddressRow): CustomerAddress {
    return CustomerAddress.create(row);
  }
}
