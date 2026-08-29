import { diopterToCenti, eyeMeasurementSchema } from '@iecp/validation';

import type { EyeMeasurementCenti } from '../entities/prescription.entity';

export class InvalidPrescriptionMeasurementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPrescriptionMeasurementError';
  }
}

/** Input shape at the DTO boundary — float diopters/mm, exactly
 * `packages/validation`'s own `EyeMeasurement` type. */
export interface EyeMeasurementInputDiopters {
  sph: number;
  cyl?: number | null;
  axis?: number | null;
  add?: number | null;
  pd?: number | null;
}

/**
 * The one place a float-diopter eye measurement is validated and
 * converted to the persisted centi-unit representation — reused by
 * every use case that accepts prescription input (create, and the
 * future "create new version" path), so bounds/step/axis-requires-cyl
 * checking never has to be re-derived per call site. Delegates the
 * actual rule to `packages/validation`'s `eyeMeasurementSchema`
 * (`PRESCRIPTION_BOUNDS` — the technical baseline `CLINICAL_APPROVAL_STATUS
 * = 'PENDING'` still applies to), never re-implements it — a bounds
 * revision only ever needs to change one place.
 */
export class EyeMeasurementValidator {
  static validate(input: EyeMeasurementInputDiopters): EyeMeasurementCenti {
    const result = eyeMeasurementSchema.safeParse({
      sph: input.sph,
      cyl: input.cyl ?? undefined,
      axis: input.axis ?? undefined,
      add: input.add ?? undefined,
      pd: input.pd ?? undefined,
    });
    if (!result.success) {
      const first = result.error.issues[0];
      throw new InvalidPrescriptionMeasurementError(first?.message ?? 'Invalid eye measurement');
    }
    const eye = result.data;
    return {
      sph: diopterToCenti(eye.sph),
      cyl: eye.cyl === undefined ? null : diopterToCenti(eye.cyl),
      axis: eye.axis ?? null,
      add: eye.add === undefined ? null : diopterToCenti(eye.add),
      pd: eye.pd === undefined ? null : diopterToCenti(eye.pd),
    };
  }
}
