import type { PrescriptionId, UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import type { AuditLogRepositoryPort } from '../../../identity/domain/ports/audit-log.repository.port';
import { AUDIT_LOG_REPOSITORY } from '../../../identity/domain/ports/audit-log.repository.port';
import type { Prescription } from '../../domain/entities/prescription.entity';
import type { CustomerRepositoryPort } from '../../domain/ports/customer.repository.port';
import { CUSTOMER_REPOSITORY } from '../../domain/ports/customer.repository.port';
import type { PrescriptionRepositoryPort } from '../../domain/ports/prescription.repository.port';
import { PRESCRIPTION_REPOSITORY } from '../../domain/ports/prescription.repository.port';
import {
  CustomerNotFoundError,
  PrescriptionNotApprovedError,
  PrescriptionNotFoundError,
  PrescriptionOwnershipError,
} from '../../domain/services/customer-domain-errors';
import type { EyeMeasurementInputDiopters } from '../../domain/services/eye-measurement-validator';
import { EyeMeasurementValidator } from '../../domain/services/eye-measurement-validator';

/**
 * `POST/GET /customers/me/prescriptions[/:id]`, `.../submit`, and the
 * reviewer-only `.../review` group. Customer-facing methods derive
 * `customerId` server-side (`CurrentUserId` → `resolveCustomerId`,
 * never a client-supplied field) and enforce ownership the same way
 * `CustomerAddressService` does — a prescription id that exists but
 * isn't the caller's own produces `PrescriptionOwnershipError`, the
 * same 404 shape a genuinely missing id would. Reviewer methods take no
 * customerId at all — access is gated purely by
 * `@RequirePermission('customer.prescription.review')` at the
 * controller, matching `ReturnAdminController`'s own RBAC-only (no
 * ownership check) shape, since a reviewer is by definition allowed to
 * act on any customer's prescription.
 */
@Injectable()
export class PrescriptionService {
  constructor(
    @Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepositoryPort,
    @Inject(PRESCRIPTION_REPOSITORY) private readonly prescriptions: PrescriptionRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  private async resolveCustomerId(userId: UserId) {
    const customer = await this.customers.findByUserId(userId);
    if (!customer) throw new CustomerNotFoundError();
    return customer.id;
  }

  private async loadOwned(customerIdStr: string, id: PrescriptionId): Promise<Prescription> {
    const prescription = await this.prescriptions.findById(id);
    if (!prescription) throw new PrescriptionNotFoundError(id);
    if (prescription.customerId !== customerIdStr) throw new PrescriptionOwnershipError();
    return prescription;
  }

  async list(userId: UserId): Promise<Prescription[]> {
    const customerId = await this.resolveCustomerId(userId);
    return this.prescriptions.listByCustomer(customerId);
  }

  async get(userId: UserId, id: PrescriptionId): Promise<Prescription> {
    const customerId = await this.resolveCustomerId(userId);
    return this.loadOwned(customerId, id);
  }

  /** Creates the first `DRAFT` version of a brand-new lineage. Eye
   * measurements are validated/converted once, here — never trusted
   * from the client in centi-unit form (a client could otherwise submit
   * an out-of-range integer that happens to look plausible after the
   * ×100 scale, bypassing `PRESCRIPTION_BOUNDS`). */
  async create(
    userId: UserId,
    props: {
      rightEye: EyeMeasurementInputDiopters;
      leftEye: EyeMeasurementInputDiopters;
      notes: string | null;
      issuedAt: Date | null;
      expiresAt: Date | null;
    },
  ): Promise<Prescription> {
    const customerId = await this.resolveCustomerId(userId);
    const rightEye = EyeMeasurementValidator.validate(props.rightEye);
    const leftEye = EyeMeasurementValidator.validate(props.leftEye);

    const created = await this.prescriptions.create({
      customerId,
      rightEye,
      leftEye,
      notes: props.notes,
      issuedAt: props.issuedAt,
      expiresAt: props.expiresAt,
    });
    await this.auditLog.record({
      actorId: userId,
      action: 'PRESCRIPTION_CREATED',
      entityType: 'Prescription',
      entityId: created.id,
      newValue: { rootId: created.rootId, version: created.version },
    });
    return created;
  }

  /** `DRAFT -> SUBMITTED`. Ownership-checked first (an owner-mismatch
   * must never even reach the state machine). */
  async submit(userId: UserId, id: PrescriptionId): Promise<Prescription> {
    const customerId = await this.resolveCustomerId(userId);
    await this.loadOwned(customerId, id);
    const updated = await this.prescriptions.transition(id, 'SUBMITTED');
    await this.auditLog.record({
      actorId: userId,
      action: 'PRESCRIPTION_SUBMITTED',
      entityType: 'Prescription',
      entityId: id,
    });
    return updated;
  }

  /** Reviewer-only — `SUBMITTED -> UNDER_REVIEW`. No ownership check:
   * gated by `@RequirePermission('customer.prescription.review')`. */
  async startReview(reviewerUserId: string, id: PrescriptionId): Promise<Prescription> {
    const updated = await this.prescriptions.transition(id, 'UNDER_REVIEW', { reviewedByUserId: reviewerUserId });
    await this.auditLog.record({
      actorId: reviewerUserId,
      action: 'PRESCRIPTION_REVIEW_STARTED',
      entityType: 'Prescription',
      entityId: id,
    });
    return updated;
  }

  /** Reviewer-only — `UNDER_REVIEW -> APPROVED`, superseding the
   * predecessor version (if any) in the same transaction. See
   * `PrismaPrescriptionRepository.approve()` for the concurrency
   * account; `PrescriptionVersionConflictError` propagates untouched to
   * the exception filter (409) if a concurrent approval in the same
   * lineage already won the race. */
  async approve(reviewerUserId: string, id: PrescriptionId): Promise<Prescription> {
    const updated = await this.prescriptions.approve(id, reviewerUserId);
    await this.auditLog.record({
      actorId: reviewerUserId,
      action: 'PRESCRIPTION_APPROVED',
      entityType: 'Prescription',
      entityId: id,
    });
    return updated;
  }

  /** Reviewer-only — `UNDER_REVIEW -> REJECTED`. */
  async reject(reviewerUserId: string, id: PrescriptionId, reason: string): Promise<Prescription> {
    const updated = await this.prescriptions.transition(id, 'REJECTED', {
      reviewedByUserId: reviewerUserId,
      rejectionReason: reason,
    });
    await this.auditLog.record({
      actorId: reviewerUserId,
      action: 'PRESCRIPTION_REJECTED',
      entityType: 'Prescription',
      entityId: id,
      newValue: { reason },
    });
    return updated;
  }

  /** Customer-facing "correct an approved prescription" path — creates
   * a new `DRAFT` version in the same lineage rather than mutating the
   * approved row in place (CP-019's own immutability requirement).
   * Only legal from an `APPROVED` predecessor the caller owns. */
  async createNewVersion(
    userId: UserId,
    previousVersionId: PrescriptionId,
    props: {
      rightEye: EyeMeasurementInputDiopters;
      leftEye: EyeMeasurementInputDiopters;
      notes: string | null;
      issuedAt: Date | null;
      expiresAt: Date | null;
    },
  ): Promise<Prescription> {
    const customerId = await this.resolveCustomerId(userId);
    const previous = await this.loadOwned(customerId, previousVersionId);
    if (previous.status !== 'APPROVED') throw new PrescriptionNotApprovedError();

    const rightEye = EyeMeasurementValidator.validate(props.rightEye);
    const leftEye = EyeMeasurementValidator.validate(props.leftEye);

    const created = await this.prescriptions.createNewVersion({
      previousVersionId,
      customerId,
      rightEye,
      leftEye,
      notes: props.notes,
      issuedAt: props.issuedAt,
      expiresAt: props.expiresAt,
    });
    await this.auditLog.record({
      actorId: userId,
      action: 'PRESCRIPTION_NEW_VERSION_CREATED',
      entityType: 'Prescription',
      entityId: created.id,
      newValue: { rootId: created.rootId, version: created.version, previousVersionId },
    });
    return created;
  }
}
