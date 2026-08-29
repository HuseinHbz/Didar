# Customer & prescription security (CP-019)

This document is `docs/security/README.md`'s "In place today" table,
expanded for the module CP-019 added. Read [`README.md`](./README.md)
first for what applies service-wide; this document only covers what's
specific to the customer/prescription domain. Full rationale, including
the encryption-at-rest and legal-status decisions this document only
summarizes: [`docs/adr/ADR-019-customer-domain-prescription.md`](../adr/ADR-019-customer-domain-prescription.md).
Route-to-permission mapping: [`docs/api/customer.md`](../api/customer.md).

## Auth model

- **`me/*`** — authenticated-only (the service's global `JwtAuthGuard` +
  `AuthorizationGuard`; no `@RequirePermission`/`@RequireModule`
  decorator). Ownership is enforced by the application layer
  (`CustomerAddressService`/`PrescriptionService`), never by a route
  decorator — the same self-service shape `me/sessions` establishes.
  `CurrentUserId` derives the caller's identity from the verified JWT;
  `customerId` is always resolved server-side from that, never accepted
  from the request body/params.
- **`admin/prescriptions/*`** — RBAC, gated by
  `@RequirePermission('customer.prescription.review')`. No ownership
  check by design — a reviewer may act on any customer's prescription.

## Ownership / IDOR posture

An address or prescription id that exists but belongs to a different
customer produces the exact same response an id that doesn't exist at
all would — `AddressOwnershipError`/`PrescriptionOwnershipError` map to
404, identically to `AddressNotFoundError`/`PrescriptionNotFoundError`.
A caller enumerating ids cannot distinguish "not yours" from "doesn't
exist." Proven by `customer.e2e-spec.ts`'s IDOR tests (scenario 8: cross-
customer address and prescription access), not merely asserted.

## RBAC model

One new permission:

| Permission                     | Meaning                                                                 |
| ------------------------------- | ------------------------------------------------------------------------ |
| `customer.prescription.review`  | Start review of, approve, or reject any customer's submitted prescription |

Granted to a dedicated `prescription_reviewer` role only — **not** folded
into `admin`'s blanket per-module grant loop in `seed.ts`, the same
"dedicated role, not admin-by-default" treatment `returns_manager`/
`returns_clerk` get for `return`/`credit_note`. An `admin`-role token
does **not** automatically pass `customer.prescription.review` unless
also granted `prescription_reviewer` (or the specific permission).

## Concurrency correctness (not just a functional nicety here)

Two Postgres partial unique indexes are the actual security/integrity
backstop, not application-layer locking alone:

- `customer_addresses_one_default_per_customer` — at most one live
  default address per customer, even under two concurrent `POST
  .../default` calls.
- `prescriptions_one_approved_per_root` — at most one live `APPROVED`
  version per prescription lineage, even under two concurrent `POST
  .../approve` calls for different versions of the same lineage. The
  losing request's Prisma P2002 is caught and re-thrown as
  `PrescriptionVersionConflictError` (409) — verified against a real
  concurrent-approval race in `customer.e2e-spec.ts`, not assumed.

## Audit logging

Every meaningful action is recorded via `AuditLogRepositoryPort`:
`CUSTOMER_PROFILE_UPDATED`, `CUSTOMER_ADDRESS_{CREATED,UPDATED,DELETED,
SET_DEFAULT}`, `PRESCRIPTION_{CREATED,SUBMITTED,REVIEW_STARTED,APPROVED,
REJECTED,NEW_VERSION_CREATED}`. Audit `newValue` payloads for
prescription actions carry only lineage/version identifiers, status
transitions, and (for rejection) the reviewer's stated reason — **never**
SPH/CYL/AXIS/ADD/PD values. No prescription measurement ever reaches an
ordinary application log line either (`console`/Nest `Logger` calls in
this module log only ids and statuses).

## Encryption at rest (Q4 — PENDING)

This phase does not add application-level encryption for prescription
measurements; see ADR-019 §8 for the full reasoning (this repository has
no existing "encrypt every sensitive column" precedent, and no
documented disk/volume-level guarantee this codebase can itself assert).
The final Security Reviewer decision on whether prescription data
specifically warrants its own encryption boundary is **PENDING** — see
`docs/product/phase-019-final-acceptance.md`, Q4. This is a stated
open item, not a silent gap.

## Validation baseline (Q1 — PENDING clinical review)

`PRESCRIPTION_BOUNDS` (`@iecp/validation`) is enforced at both the DTO
layer (`eyeMeasurementSchema`) and the database (CHECK constraints on
`customer.prescriptions`) — the same value, never duplicated by hand.
`CLINICAL_APPROVAL_STATUS = 'PENDING'` is a real, checked constant, and
every prescription API response echoes it — a client cannot mistake a
reviewer's workflow `APPROVED` for a clinically reviewed bounds spec.

## Legal / regulatory status (Q5 — PENDING, status UNKNOWN)

No Iranian medical-device or prescription-handling regulation is cited
anywhere in this codebase, and none is invented here. See ADR-019 §9.
