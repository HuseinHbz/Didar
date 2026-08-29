import type { UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import type { AuditLogRepositoryPort } from '../../../identity/domain/ports/audit-log.repository.port';
import { AUDIT_LOG_REPOSITORY } from '../../../identity/domain/ports/audit-log.repository.port';
import type { Customer } from '../../domain/entities/customer.entity';
import type { CustomerRepositoryPort } from '../../domain/ports/customer.repository.port';
import { CUSTOMER_REPOSITORY } from '../../domain/ports/customer.repository.port';
import { CustomerNotFoundError } from '../../domain/services/customer-domain-errors';

/** `GET/PATCH /customers/me` — always scoped to the caller's own profile
 * via `CurrentUserId` (server-derived from the JWT), never a client-
 * supplied customerId. No RBAC permission is consumed: this is a
 * self-service route, ownership is intrinsic (a caller can only ever be
 * "the current user"), the same shape `SessionsController` already
 * establishes for `me/sessions`. */
@Injectable()
export class CustomerProfileService {
  constructor(
    @Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async getMe(userId: UserId): Promise<Customer> {
    const customer = await this.customers.findByUserId(userId);
    if (!customer) throw new CustomerNotFoundError();
    return customer;
  }

  /** Only non-identity-critical fields are mutable here — `nationalId`
   * is deliberately absent from the update surface (identity data, not
   * a "profile" field; changing it is out of CP-019's scope). */
  async updateMe(
    userId: UserId,
    props: {
      firstName?: string;
      lastName?: string;
      birthDate?: Date | null;
      gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
    },
  ): Promise<Customer> {
    const existing = await this.customers.findByUserId(userId);
    if (!existing) throw new CustomerNotFoundError();

    const updated = await this.customers.updateProfile(existing.id, props);
    await this.auditLog.record({
      actorId: userId,
      action: 'CUSTOMER_PROFILE_UPDATED',
      entityType: 'Customer',
      entityId: existing.id,
      newValue: props,
    });
    return updated;
  }
}
