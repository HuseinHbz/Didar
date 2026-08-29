import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AUDIT_LOG_REPOSITORY } from '../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../identity/infrastructure/repositories/prisma-audit-log.repository';

import { CustomerAddressService } from './application/addresses/customer-address.service';
import { PrescriptionService } from './application/prescriptions/prescription.service';
import { CustomerProfileService } from './application/profile/customer-profile.service';
import { CUSTOMER_ADDRESS_REPOSITORY } from './domain/ports/customer-address.repository.port';
import { CUSTOMER_REPOSITORY } from './domain/ports/customer.repository.port';
import { PRESCRIPTION_REPOSITORY } from './domain/ports/prescription.repository.port';
import { PrismaCustomerAddressRepository } from './infrastructure/repositories/prisma-customer-address.repository';
import { PrismaCustomerRepository } from './infrastructure/repositories/prisma-customer.repository';
import { PrismaPrescriptionRepository } from './infrastructure/repositories/prisma-prescription.repository';
import { CustomerAddressController } from './presentation/controllers/customer-address.controller';
import { CustomerProfileController } from './presentation/controllers/customer-profile.controller';
import { PrescriptionReviewController } from './presentation/controllers/prescription-review.controller';
import { PrescriptionController } from './presentation/controllers/prescription.controller';
import { CustomerDomainExceptionFilter } from './presentation/filters/customer-domain-exception.filter';

/**
 * CP-019 composition root (docs/adr/ADR-019-customer-domain-prescription.md).
 * Every port token is bound to its Prisma implementation here, same
 * convention every prior phase's own composition root establishes
 * (`ReturnModule`, `OrderModule`, ...). `AUDIT_LOG_REPOSITORY` is
 * re-bound locally rather than imported from `IdentityModule` — that
 * module only exports `JwtTokenService`, same reasoning
 * `ReturnModule`'s own doc comment gives.
 *
 * `IdentityModule`'s `JwtAuthGuard`/`AuthorizationGuard` are already
 * global (`APP_GUARD`, registered in `IdentityModule`) — no extra guard
 * wiring is needed here; `me/*` routes are authenticated-only (no
 * decorator, matching `SessionsController`), `admin/prescriptions/*`
 * routes carry `@RequirePermission('customer.prescription.review')`.
 */
@Module({
  controllers: [
    CustomerProfileController,
    CustomerAddressController,
    PrescriptionController,
    PrescriptionReviewController,
  ],
  providers: [
    { provide: CUSTOMER_REPOSITORY, useClass: PrismaCustomerRepository },
    { provide: CUSTOMER_ADDRESS_REPOSITORY, useClass: PrismaCustomerAddressRepository },
    { provide: PRESCRIPTION_REPOSITORY, useClass: PrismaPrescriptionRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    CustomerProfileService,
    CustomerAddressService,
    PrescriptionService,
    { provide: APP_FILTER, useClass: CustomerDomainExceptionFilter },
  ],
  exports: [CustomerProfileService, CustomerAddressService, PrescriptionService],
})
export class CustomerModule {}
