import type { CustomerId, PrescriptionId , PrescriptionStatus } from '@iecp/types';

import type { EyeMeasurementCenti, Prescription } from '../entities/prescription.entity';

export const PRESCRIPTION_REPOSITORY = Symbol('PRESCRIPTION_REPOSITORY');

export interface PrescriptionRepositoryPort {
  findById(id: PrescriptionId): Promise<Prescription | null>;
  listByCustomer(customerId: CustomerId): Promise<Prescription[]>;
  /** Creates the first version in a brand-new lineage — `rootId` equals
   * the new row's own `id`. */
  create(props: {
    customerId: CustomerId;
    rightEye: EyeMeasurementCenti;
    leftEye: EyeMeasurementCenti;
    notes: string | null;
    issuedAt: Date | null;
    expiresAt: Date | null;
  }): Promise<Prescription>;
  /** Real, in-place edit — legal only while `status` is `DRAFT`
   * (enforced by the calling use case via `PrescriptionStateMachine`
   * semantics before this is ever called; the repository itself trusts
   * its caller, matching every other repository in this repo). */
  updateDraft(
    id: PrescriptionId,
    props: Partial<{
      rightEye: EyeMeasurementCenti;
      leftEye: EyeMeasurementCenti;
      notes: string | null;
      issuedAt: Date | null;
      expiresAt: Date | null;
    }>,
  ): Promise<Prescription>;
  /** Row-locks (`SELECT ... FOR UPDATE`), asserts the transition via
   * `PrescriptionStateMachine`, writes the new status — the same
   * concurrency-safe transition shape `PrismaReturnRepository`/
   * `PrismaReturnSettlementRepository` already establish. Throws
   * `InvalidPrescriptionTransitionError` if `from` no longer matches the
   * row's actual current status by the time the lock is held (a
   * concurrent transition already happened). */
  transition(
    id: PrescriptionId,
    to: Extract<PrescriptionStatus, 'SUBMITTED' | 'UNDER_REVIEW' | 'REJECTED'>,
    extra?: { reviewedByUserId?: string; rejectionReason?: string },
  ): Promise<Prescription>;
  /** Approves `id` and, in the same transaction, marks its immediate
   * predecessor (if any) `SUPERSEDED` — the one write path that can ever
   * produce a `SUPERSEDED` row. Relies on
   * `prescriptions_one_approved_per_root` to reject a concurrent
   * duplicate approval in the same lineage; that unique-violation is
   * caught here and re-thrown as `PrescriptionVersionConflictError`. */
  approve(id: PrescriptionId, reviewedByUserId: string): Promise<Prescription>;
  /** Creates a new `DRAFT` version superseding `previousVersionId` —
   * `previousVersionId` must currently be `APPROVED` (checked by the
   * calling use case via `PrescriptionNotApprovedError` before this is
   * called). */
  createNewVersion(props: {
    previousVersionId: PrescriptionId;
    customerId: CustomerId;
    rightEye: EyeMeasurementCenti;
    leftEye: EyeMeasurementCenti;
    notes: string | null;
    issuedAt: Date | null;
    expiresAt: Date | null;
  }): Promise<Prescription>;
}
