import { z } from 'zod';

/**
 * Iranian mobile numbers: `09xxxxxxxxx` (11 digits) or `+989xxxxxxxxx` / `00989xxxxxxxxx`.
 * Normalizes to the `+98` E.164-ish form used as the canonical stored value.
 */
export const iranMobileSchema = z
  .string()
  .trim()
  .regex(/^(?:\+98|0098|0)?9\d{9}$/, 'Invalid Iranian mobile number')
  .transform((value) => {
    const digits = value.replace(/^(?:\+98|0098|0)/, '');
    return `+98${digits}`;
  });

export type IranMobile = z.infer<typeof iranMobileSchema>;
