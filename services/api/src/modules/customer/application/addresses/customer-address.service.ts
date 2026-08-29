import type { CustomerAddressId, UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import type { AuditLogRepositoryPort } from '../../../identity/domain/ports/audit-log.repository.port';
import { AUDIT_LOG_REPOSITORY } from '../../../identity/domain/ports/audit-log.repository.port';
import type { CustomerAddress } from '../../domain/entities/customer-address.entity';
import type { CustomerAddressRepositoryPort } from '../../domain/ports/customer-address.repository.port';
import { CUSTOMER_ADDRESS_REPOSITORY } from '../../domain/ports/customer-address.repository.port';
import type { CustomerRepositoryPort } from '../../domain/ports/customer.repository.port';
import { CUSTOMER_REPOSITORY } from '../../domain/ports/customer.repository.port';
import {
  AddressNotFoundError,
  AddressOwnershipError,
  CustomerNotFoundError,
} from '../../domain/services/customer-domain-errors';

/** `GET/POST/PATCH/DELETE /customers/me/addresses[/:id]` — every
 * mutation is ownership-checked here, in the application layer, not by
 * a route decorator (the same "self-service resource, RBAC-free,
 * ownership enforced by the use case" shape `RevokeSessionUseCase`
 * establishes). A customer probing another customer's address id gets
 * exactly the same `AddressOwnershipError` a genuinely missing id would
 * produce — see that error's own doc comment. */
@Injectable()
export class CustomerAddressService {
  constructor(
    @Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepositoryPort,
    @Inject(CUSTOMER_ADDRESS_REPOSITORY) private readonly addresses: CustomerAddressRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  private async resolveCustomerId(userId: UserId) {
    const customer = await this.customers.findByUserId(userId);
    if (!customer) throw new CustomerNotFoundError();
    return customer.id;
  }

  private async loadOwned(customerIdStr: string, id: CustomerAddressId): Promise<CustomerAddress> {
    const address = await this.addresses.findById(id);
    if (!address) throw new AddressNotFoundError(id);
    if (address.customerId !== customerIdStr) throw new AddressOwnershipError();
    return address;
  }

  async list(userId: UserId): Promise<CustomerAddress[]> {
    const customerId = await this.resolveCustomerId(userId);
    return this.addresses.listByCustomer(customerId);
  }

  async create(
    userId: UserId,
    props: {
      label: string | null;
      recipientName: string;
      phone: string;
      province: string;
      city: string;
      addressLine1: string;
      addressLine2: string | null;
      postalCode: string | null;
      isDefault: boolean;
    },
  ): Promise<CustomerAddress> {
    const customerId = await this.resolveCustomerId(userId);
    const created = await this.addresses.create({ customerId, ...props });
    await this.auditLog.record({
      actorId: userId,
      action: 'CUSTOMER_ADDRESS_CREATED',
      entityType: 'CustomerAddress',
      entityId: created.id,
      newValue: { province: props.province, city: props.city, isDefault: created.isDefault },
    });
    return created;
  }

  async update(
    userId: UserId,
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
    const customerId = await this.resolveCustomerId(userId);
    await this.loadOwned(customerId, id);
    const updated = await this.addresses.update(id, props);
    await this.auditLog.record({
      actorId: userId,
      action: 'CUSTOMER_ADDRESS_UPDATED',
      entityType: 'CustomerAddress',
      entityId: id,
      newValue: props,
    });
    return updated;
  }

  async remove(userId: UserId, id: CustomerAddressId): Promise<void> {
    const customerId = await this.resolveCustomerId(userId);
    await this.loadOwned(customerId, id);
    await this.addresses.softDelete(id);
    await this.auditLog.record({
      actorId: userId,
      action: 'CUSTOMER_ADDRESS_DELETED',
      entityType: 'CustomerAddress',
      entityId: id,
    });
  }

  async setDefault(userId: UserId, id: CustomerAddressId): Promise<CustomerAddress> {
    const customerId = await this.resolveCustomerId(userId);
    await this.loadOwned(customerId, id);
    const updated = await this.addresses.setDefault(id, customerId);
    await this.auditLog.record({
      actorId: userId,
      action: 'CUSTOMER_ADDRESS_SET_DEFAULT',
      entityType: 'CustomerAddress',
      entityId: id,
    });
    return updated;
  }
}
