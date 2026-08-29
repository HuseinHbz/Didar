import { asCustomerId, asPrescriptionId, type CustomerId, type PrescriptionId , type PrescriptionStatus } from '@iecp/types';

/** One eye's measurements, in the persisted centi-unit representation
 * (see `packages/validation/src/prescription.ts`'s `diopterToCenti`/
 * `centiToDiopter`). `sph` is required; every other field is optional,
 * mirroring `eyeMeasurementSchema`. */
export interface EyeMeasurementCenti {
  sph: number;
  cyl: number | null;
  axis: number | null;
  add: number | null;
  pd: number | null;
}

/** Each instance is one immutable *version* — see this module's README
 * and the Prisma schema's own doc comment on `Prescription` for the
 * full versioning/lineage account. `rootId` groups a lineage;
 * `previousVersionId` chains to the exact predecessor. */
export class Prescription {
  private constructor(
    public readonly id: PrescriptionId,
    public readonly rootId: PrescriptionId,
    public readonly version: number,
    public readonly customerId: CustomerId,
    public readonly previousVersionId: PrescriptionId | null,
    public readonly status: PrescriptionStatus,
    public readonly rightEye: EyeMeasurementCenti,
    public readonly leftEye: EyeMeasurementCenti,
    public readonly notes: string | null,
    public readonly issuedAt: Date | null,
    public readonly expiresAt: Date | null,
    public readonly submittedAt: Date | null,
    public readonly reviewStartedAt: Date | null,
    public readonly reviewedByUserId: string | null,
    public readonly reviewedAt: Date | null,
    public readonly rejectionReason: string | null,
    public readonly supersededAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    rootId: string;
    version: number;
    customerId: string;
    previousVersionId?: string | null;
    status?: PrescriptionStatus;
    rightEye: EyeMeasurementCenti;
    leftEye: EyeMeasurementCenti;
    notes?: string | null;
    issuedAt?: Date | null;
    expiresAt?: Date | null;
    submittedAt?: Date | null;
    reviewStartedAt?: Date | null;
    reviewedByUserId?: string | null;
    reviewedAt?: Date | null;
    rejectionReason?: string | null;
    supersededAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Prescription {
    return new Prescription(
      asPrescriptionId(props.id),
      asPrescriptionId(props.rootId),
      props.version,
      asCustomerId(props.customerId),
      props.previousVersionId ? asPrescriptionId(props.previousVersionId) : null,
      props.status ?? 'DRAFT',
      props.rightEye,
      props.leftEye,
      props.notes ?? null,
      props.issuedAt ?? null,
      props.expiresAt ?? null,
      props.submittedAt ?? null,
      props.reviewStartedAt ?? null,
      props.reviewedByUserId ?? null,
      props.reviewedAt ?? null,
      props.rejectionReason ?? null,
      props.supersededAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  /** Whether this specific version is `APPROVED` and therefore immutable
   * — CP-019's own acceptance criteria: "do not mutate its clinical
   * measurements in-place" once approved. */
  get isImmutable(): boolean {
    return this.status === 'APPROVED' || this.status === 'SUPERSEDED' || this.status === 'REJECTED';
  }
}
