import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import type { CustomerId, PrescriptionId , PrescriptionStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { EyeMeasurementCenti } from '../../domain/entities/prescription.entity';
import { Prescription } from '../../domain/entities/prescription.entity';
import type { PrescriptionRepositoryPort } from '../../domain/ports/prescription.repository.port';
import { PrescriptionNotFoundError, PrescriptionVersionConflictError } from '../../domain/services/customer-domain-errors';
import { PrescriptionStateMachine } from '../../domain/services/prescription-state-machine';

interface PrescriptionRow {
  id: string;
  rootId: string;
  version: number;
  customerId: string;
  previousVersionId: string | null;
  status: PrescriptionStatus;
  rightSph: number;
  rightCyl: number | null;
  rightAxis: number | null;
  rightAdd: number | null;
  rightPd: number | null;
  leftSph: number;
  leftCyl: number | null;
  leftAxis: number | null;
  leftAdd: number | null;
  leftPd: number | null;
  notes: string | null;
  issuedAt: Date | null;
  expiresAt: Date | null;
  submittedAt: Date | null;
  reviewStartedAt: Date | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A computed-key object literal (`[`${prefix}Sph`]: ...`) types as a
 * generic index signature, which Prisma's precisely-keyed input types
 * reject — these two explicit-key overloads keep the single call site
 * in every method below while still producing a type Prisma accepts. */
function eyeFields(
  prefix: 'right',
  eye: EyeMeasurementCenti,
): { rightSph: number; rightCyl: number | null; rightAxis: number | null; rightAdd: number | null; rightPd: number | null };
function eyeFields(
  prefix: 'left',
  eye: EyeMeasurementCenti,
): { leftSph: number; leftCyl: number | null; leftAxis: number | null; leftAdd: number | null; leftPd: number | null };
function eyeFields(prefix: 'right' | 'left', eye: EyeMeasurementCenti) {
  return prefix === 'right'
    ? { rightSph: eye.sph, rightCyl: eye.cyl, rightAxis: eye.axis, rightAdd: eye.add, rightPd: eye.pd }
    : { leftSph: eye.sph, leftCyl: eye.cyl, leftAxis: eye.axis, leftAdd: eye.add, leftPd: eye.pd };
}

function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.['target'] as string | string[] | undefined)?.includes(column) === true
  );
}

/** Prescription persistence — the row-lock + assert-transition shape
 * mirrors `PrismaReturnSettlementRepository.updateStatus()` exactly.
 * `approve()` is the one write path that can additionally mark a
 * *different* row (the predecessor) `SUPERSEDED`, all inside the same
 * transaction — see the migration's own comment on
 * `prescriptions_one_approved_per_root` for why the ordering there
 * matters. */
@Injectable()
export class PrismaPrescriptionRepository implements PrescriptionRepositoryPort {
  async findById(id: PrescriptionId): Promise<Prescription | null> {
    const row = await prisma.prescription.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async listByCustomer(customerId: CustomerId): Promise<Prescription[]> {
    const rows = await prisma.prescription.findMany({
      where: { customerId },
      orderBy: [{ rootId: 'asc' }, { version: 'desc' }],
    });
    return rows.map((row) => this.toDomain(row));
  }

  /** First version in a brand-new lineage — `rootId` is set to the new
   * row's own generated `id` (see the migration's note on why this is
   * not a real FK). */
  async create(props: {
    customerId: CustomerId;
    rightEye: EyeMeasurementCenti;
    leftEye: EyeMeasurementCenti;
    notes: string | null;
    issuedAt: Date | null;
    expiresAt: Date | null;
  }): Promise<Prescription> {
    const id = randomUUID();
    const row = await prisma.prescription.create({
      data: {
        id,
        rootId: id,
        version: 1,
        customerId: props.customerId,
        status: 'DRAFT',
        notes: props.notes,
        issuedAt: props.issuedAt,
        expiresAt: props.expiresAt,
        ...eyeFields('right', props.rightEye),
        ...eyeFields('left', props.leftEye),
      },
    });
    return this.toDomain(row);
  }

  async updateDraft(
    id: PrescriptionId,
    props: Partial<{
      rightEye: EyeMeasurementCenti;
      leftEye: EyeMeasurementCenti;
      notes: string | null;
      issuedAt: Date | null;
      expiresAt: Date | null;
    }>,
  ): Promise<Prescription> {
    const row = await prisma.prescription.update({
      where: { id },
      data: {
        notes: props.notes,
        issuedAt: props.issuedAt,
        expiresAt: props.expiresAt,
        ...(props.rightEye ? eyeFields('right', props.rightEye) : {}),
        ...(props.leftEye ? eyeFields('left', props.leftEye) : {}),
      },
    });
    return this.toDomain(row);
  }

  async transition(
    id: PrescriptionId,
    to: Extract<PrescriptionStatus, 'SUBMITTED' | 'UNDER_REVIEW' | 'REJECTED'>,
    extra?: { reviewedByUserId?: string; rejectionReason?: string },
  ): Promise<Prescription> {
    const row = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: PrescriptionStatus }[]>(
        Prisma.sql`SELECT status FROM customer.prescriptions WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const currentStatus = locked[0]?.status;
      if (currentStatus === undefined) throw new PrescriptionNotFoundError(id);

      PrescriptionStateMachine.assertTransition(currentStatus, to);

      const now = new Date();
      return tx.prescription.update({
        where: { id },
        data: {
          status: to,
          submittedAt: to === 'SUBMITTED' ? now : undefined,
          reviewStartedAt: to === 'UNDER_REVIEW' ? now : undefined,
          reviewedByUserId: to === 'UNDER_REVIEW' || to === 'REJECTED' ? extra?.reviewedByUserId : undefined,
          reviewedAt: to === 'REJECTED' ? now : undefined,
          rejectionReason: to === 'REJECTED' ? extra?.rejectionReason : undefined,
        },
      });
    });
    return this.toDomain(row);
  }

  /** Approves `id` and, in the same transaction, supersedes its
   * immediate predecessor first (if any) — that ordering is what keeps
   * `prescriptions_one_approved_per_root` from ever seeing two live
   * `APPROVED` rows for the same lineage at once. A concurrent second
   * approval attempt in the same lineage loses the unique-index race;
   * that violation is caught here and re-thrown as the typed domain
   * error instead of a raw Prisma exception. */
  async approve(id: PrescriptionId, reviewedByUserId: string): Promise<Prescription> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ status: PrescriptionStatus; previousVersionId: string | null }[]>(
          Prisma.sql`SELECT status, previous_version_id AS "previousVersionId" FROM customer.prescriptions WHERE id = ${id}::uuid FOR UPDATE`,
        );
        const current = locked[0];
        if (current === undefined) throw new PrescriptionNotFoundError(id);

        PrescriptionStateMachine.assertTransition(current.status, 'APPROVED');

        if (current.previousVersionId) {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM customer.prescriptions WHERE id = ${current.previousVersionId}::uuid FOR UPDATE`,
          );
          await tx.prescription.update({
            where: { id: current.previousVersionId },
            data: { status: 'SUPERSEDED', supersededAt: new Date() },
          });
        }

        return tx.prescription.update({
          where: { id },
          data: { status: 'APPROVED', reviewedByUserId, reviewedAt: new Date() },
        });
      });
      return this.toDomain(row);
    } catch (error) {
      // Prisma's P2002 `meta.target` for a raw-SQL partial unique index
      // (this one has no `@@unique` counterpart in schema.prisma — see
      // the migration's own comment) is the underlying *column* list
      // (`['root_id']`), not the index name — confirmed against a real
      // concurrent-approval race, not assumed.
      if (isUniqueViolationOn(error, 'root_id')) {
        throw new PrescriptionVersionConflictError();
      }
      throw error;
    }
  }

  /** Creates a new `DRAFT` version chained to `previousVersionId` via
   * both `rootId` (same lineage) and `previousVersionId` (exact
   * predecessor) — the calling use case has already verified the
   * predecessor is `APPROVED`. */
  async createNewVersion(props: {
    previousVersionId: PrescriptionId;
    customerId: CustomerId;
    rightEye: EyeMeasurementCenti;
    leftEye: EyeMeasurementCenti;
    notes: string | null;
    issuedAt: Date | null;
    expiresAt: Date | null;
  }): Promise<Prescription> {
    const previous = await prisma.prescription.findUniqueOrThrow({ where: { id: props.previousVersionId } });
    const row = await prisma.prescription.create({
      data: {
        id: randomUUID(),
        rootId: previous.rootId,
        version: previous.version + 1,
        customerId: props.customerId,
        previousVersionId: props.previousVersionId,
        status: 'DRAFT',
        notes: props.notes,
        issuedAt: props.issuedAt,
        expiresAt: props.expiresAt,
        ...eyeFields('right', props.rightEye),
        ...eyeFields('left', props.leftEye),
      },
    });
    return this.toDomain(row);
  }

  private toDomain(row: PrescriptionRow): Prescription {
    return Prescription.create({
      id: row.id,
      rootId: row.rootId,
      version: row.version,
      customerId: row.customerId,
      previousVersionId: row.previousVersionId,
      status: row.status,
      rightEye: { sph: row.rightSph, cyl: row.rightCyl, axis: row.rightAxis, add: row.rightAdd, pd: row.rightPd },
      leftEye: { sph: row.leftSph, cyl: row.leftCyl, axis: row.leftAxis, add: row.leftAdd, pd: row.leftPd },
      notes: row.notes,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      submittedAt: row.submittedAt,
      reviewStartedAt: row.reviewStartedAt,
      reviewedByUserId: row.reviewedByUserId,
      reviewedAt: row.reviewedAt,
      rejectionReason: row.rejectionReason,
      supersededAt: row.supersededAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
