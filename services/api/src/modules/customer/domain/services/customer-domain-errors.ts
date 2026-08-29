/** Every expected business failure this module's application layer can
 * throw, mapped to a real HTTP status by `CustomerDomainExceptionFilter`
 * — never a generic `new Error(...)` for something a caller can
 * legitimately trigger, matching every other module's own convention
 * (`InvalidReturnTransitionError`, `OverReturnedError`, ...). */

export class CustomerNotFoundError extends Error {
  constructor() {
    super('Customer profile not found for this account');
    this.name = 'CustomerNotFoundError';
  }
}

export class AddressNotFoundError extends Error {
  constructor(id: string) {
    super(`Address ${id} not found`);
    this.name = 'AddressNotFoundError';
  }
}

/** Thrown whenever the resolved `customerId` (always server-derived from
 * the caller's own JWT, never a client-supplied field — see
 * `CurrentCustomerId` decorator) does not own the address/prescription a
 * route was asked to act on. Deliberately the same message/shape
 * `AddressNotFoundError`/`PrescriptionNotFoundError` would give for a
 * genuinely missing row — a 404, not a 403 — so probing someone else's
 * resource id cannot be distinguished from probing a nonexistent one. */
export class AddressOwnershipError extends Error {
  constructor() {
    super('Address not found');
    this.name = 'AddressOwnershipError';
  }
}

export class PrescriptionNotFoundError extends Error {
  constructor(id: string) {
    super(`Prescription ${id} not found`);
    this.name = 'PrescriptionNotFoundError';
  }
}

export class PrescriptionOwnershipError extends Error {
  constructor() {
    super('Prescription not found');
    this.name = 'PrescriptionOwnershipError';
  }
}

/** Real Postgres unique-constraint violation on
 * `prescriptions_one_approved_per_root` — two concurrent "approve" calls
 * against the same lineage raced, and Postgres itself rejected the
 * loser. A genuine state conflict (409), not a validation error: the
 * request was well-formed, the world just changed under it. */
export class PrescriptionVersionConflictError extends Error {
  constructor() {
    super('Another version of this prescription was approved concurrently');
    this.name = 'PrescriptionVersionConflictError';
  }
}

/** A new version may only be created from an `APPROVED` predecessor —
 * creating one from a `DRAFT`/`SUBMITTED`/`UNDER_REVIEW` predecessor
 * makes no sense (edit the existing draft instead) and one from a
 * `REJECTED`/`SUPERSEDED` predecessor would create an ambiguous lineage
 * branch this module's own linear-history design doesn't support. */
export class PrescriptionNotApprovedError extends Error {
  constructor() {
    super('Only an APPROVED prescription can be superseded by a new version');
    this.name = 'PrescriptionNotApprovedError';
  }
}
