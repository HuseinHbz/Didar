import { isUuid } from '@iecp/types';

export type PrescriptionReferenceStatus = 'valid_shape' | 'invalid_shape' | 'unverified';

/**
 * Real, unit-tested function with the *correct shape* for "validate
 * existence and ownership" — but honestly incomplete (ADR-007 decision 9):
 * no `Prescription` entity exists anywhere in this schema yet, so there is
 * nothing to check existence/ownership *against*. This validator checks
 * what it actually can (the reference is a well-formed id) and returns
 * `'unverified'` for the rest, never a fabricated `'valid'`. A future
 * prescription module wires a real existence+ownership check in here
 * without changing this class's shape or its callers.
 */
export class PrescriptionReferenceValidator {
  static validate(reference: string): PrescriptionReferenceStatus {
    if (!isUuid(reference)) return 'invalid_shape';
    return 'unverified';
  }
}
