import { z } from 'zod';

/**
 * Eyeglass prescription value validation (blueprint §14 / §21).
 *
 * These are structural/range checks only — "is this a value an optical prescription
 * could plausibly contain" — NOT a medical/clinical validation. Per blueprint §21:
 * "سیستم نباید تشخیص پزشکی اختراع کند" (the system must not invent medical
 * judgement). Values within range still flow through optometrist review for
 * anything requiring professional sign-off.
 *
 * TODO(optometry-domain-expert): the numeric bounds and step below are reasonable
 * industry defaults, not a clinically reviewed spec. Confirm before this ships in
 * a real order flow — see docs/product/blueprint.md §21 and §121 (Optometry Domain
 * Specialist role).
 *
 * CP-019 (docs/adr/ADR-019-customer-domain-prescription.md) centralizes the
 * bounds this TODO refers to as `PRESCRIPTION_BOUNDS` below and builds the
 * real Prescription domain/persistence layer against them — the TODO is
 * preserved verbatim, not deleted, and `CLINICAL_APPROVAL_STATUS` records
 * explicitly that this is still a technical baseline, not a clinically
 * reviewed spec. Final sign-off is tracked in
 * docs/product/phase-019-final-acceptance.md, not here.
 */

/** `'PENDING'` until an Optometry Domain Specialist reviews `PRESCRIPTION_BOUNDS`
 * and either approves them as-is or supplies revised values (see this file's
 * own header TODO). Never flip this to `'APPROVED'` without a real, dated,
 * named sign-off recorded in `docs/product/phase-019-final-acceptance.md` —
 * this constant existing is not itself that sign-off. */
export const CLINICAL_APPROVAL_STATUS = 'PENDING' as const;

/** Every numeric bound the prescription domain validates against, in one
 * place — both this file's zod schemas (float diopters/mm, the DTO-facing
 * shape) and `packages/database`'s `Prescription` model's CHECK constraints
 * (centi-diopters/centi-mm integers, the persisted shape) derive from these
 * same numbers, so a future bounds revision (once `CLINICAL_APPROVAL_STATUS`
 * moves off `'PENDING'`) only has to change one place per axis. */
export const PRESCRIPTION_BOUNDS = {
  sph: { min: -20, max: 20, step: 0.25 },
  cyl: { min: -10, max: 10, step: 0.25 },
  axis: { min: 0, max: 180 },
  add: { min: 0, max: 4, step: 0.25 },
  /** Binocular 50-75mm, monocular 25-40mm per eye — this schema validates
   * the union range only; which of the two applies is a UI/measurement-
   * protocol concern, not a structural one. */
  pd: { min: 20, max: 80 },
} as const;

const step = (value: number, increment: number): boolean =>
  Math.round(value / increment) * increment === value;

/** Sphere power in diopters, ±20.00 in 0.25 steps. */
export const sphSchema = z
  .number()
  .min(PRESCRIPTION_BOUNDS.sph.min, 'SPH out of range')
  .max(PRESCRIPTION_BOUNDS.sph.max, 'SPH out of range')
  .refine((v) => step(v, PRESCRIPTION_BOUNDS.sph.step), 'SPH must be in 0.25 steps');

/** Cylinder power in diopters, ±10.00 in 0.25 steps. */
export const cylSchema = z
  .number()
  .min(PRESCRIPTION_BOUNDS.cyl.min, 'CYL out of range')
  .max(PRESCRIPTION_BOUNDS.cyl.max, 'CYL out of range')
  .refine((v) => step(v, PRESCRIPTION_BOUNDS.cyl.step), 'CYL must be in 0.25 steps');

/** Axis in degrees, 0-180, integer. Only meaningful when CYL != 0. */
export const axisSchema = z
  .number()
  .int()
  .min(PRESCRIPTION_BOUNDS.axis.min)
  .max(PRESCRIPTION_BOUNDS.axis.max);

/** Addition power (bifocal/progressive) in diopters, 0.00 to +4.00 in 0.25 steps. */
export const addSchema = z
  .number()
  .min(PRESCRIPTION_BOUNDS.add.min, 'ADD out of range')
  .max(PRESCRIPTION_BOUNDS.add.max, 'ADD out of range')
  .refine((v) => step(v, PRESCRIPTION_BOUNDS.add.step), 'ADD must be in 0.25 steps');

/** Pupillary distance in millimeters — binocular (50-75) or monocular (25-40) per eye. */
export const pdSchema = z
  .number()
  .min(PRESCRIPTION_BOUNDS.pd.min)
  .max(PRESCRIPTION_BOUNDS.pd.max);

export const eyeMeasurementSchema = z
  .object({
    sph: sphSchema,
    cyl: cylSchema.optional(),
    axis: axisSchema.optional(),
    add: addSchema.optional(),
    pd: pdSchema.optional(),
  })
  .refine((eye) => eye.cyl === undefined || eye.axis !== undefined, {
    message: 'AXIS is required whenever CYL is provided',
    path: ['axis'],
  });

export const prescriptionSchema = z.object({
  rightEye: eyeMeasurementSchema,
  leftEye: eyeMeasurementSchema,
  issuedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  optometristVerified: z.boolean().default(false),
});

export type EyeMeasurement = z.infer<typeof eyeMeasurementSchema>;
export type Prescription = z.infer<typeof prescriptionSchema>;

/**
 * SPH/CYL/ADD are stored as centi-diopters and PD as centi-mm — integers,
 * never floats, for the same "no float for exact business-critical values"
 * reason money columns use `BigInt` elsewhere in this repo (see
 * `packages/database`'s `Prescription` model doc comment). These two
 * helpers are the one place that conversion happens; `services/api`'s
 * customer module domain/infrastructure layers use them exclusively rather
 * than each re-deriving `* 100` by hand.
 */
export function diopterToCenti(value: number): number {
  return Math.round(value * 100);
}

export function centiToDiopter(value: number): number {
  return value / 100;
}
