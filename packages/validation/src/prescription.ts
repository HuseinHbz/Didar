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
 */

const step = (value: number, increment: number): boolean =>
  Math.round(value / increment) * increment === value;

/** Sphere power in diopters, ±20.00 in 0.25 steps. */
export const sphSchema = z
  .number()
  .min(-20, 'SPH out of range')
  .max(20, 'SPH out of range')
  .refine((v) => step(v, 0.25), 'SPH must be in 0.25 steps');

/** Cylinder power in diopters, ±10.00 in 0.25 steps. */
export const cylSchema = z
  .number()
  .min(-10, 'CYL out of range')
  .max(10, 'CYL out of range')
  .refine((v) => step(v, 0.25), 'CYL must be in 0.25 steps');

/** Axis in degrees, 0-180, integer. Only meaningful when CYL != 0. */
export const axisSchema = z.number().int().min(0).max(180);

/** Addition power (bifocal/progressive) in diopters, 0.00 to +4.00 in 0.25 steps. */
export const addSchema = z
  .number()
  .min(0, 'ADD out of range')
  .max(4, 'ADD out of range')
  .refine((v) => step(v, 0.25), 'ADD must be in 0.25 steps');

/** Pupillary distance in millimeters — binocular (50-75) or monocular (25-40) per eye. */
export const pdSchema = z.number().min(20).max(80);

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
