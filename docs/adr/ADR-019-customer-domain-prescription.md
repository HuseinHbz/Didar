# ADR-019 — Customer Domain & Prescription

**Status**: Accepted (technical baseline) — human/clinical/legal/security
acceptance **PENDING**, see §8 and `docs/product/phase-019-final-acceptance.md`.
**Phase**: 019 (`services/api/src/modules/customer`)

## 1. Problem

CP-019's product-review pass (`docs/product/phase-019-domain-review.md`)
identified five decisions requiring human sign-off (prescription numeric
bounds, review scope, data model, encryption-at-rest, Iran regulatory
status) and, correctly, refused to fabricate that sign-off. The project
decision that supersedes that gate for this phase: build the real
technical/domain foundation now, on an explicit technical baseline, and
collect the five approvals as a **final acceptance gate** rather than a
precondition to writing code. This ADR records the technical baseline
each of the five decisions now rests on. None of it claims clinical,
legal, or security approval — see §8.

## 2. Scope

Customer self-service profile/address management, and a prescription
domain with an explicit lifecycle, versioning, and a reviewer-gated
approval workflow. Out of scope: a diagnosis engine, any Iran-specific
regulatory claim, and any customer-facing UI (this phase is
`services/api` only, matching every prior phase's own backend-first
scope).

## 3. Data model decision (Q3)

Prior CP-019 documentation flagged a conflict between a flat
`Prescription` entity and a richer versioned/table-oriented model. This
phase resolves it: **one row per immutable version**, not a separate
"current prescription" table plus a "history" table.

- `id` — this version's own identity.
- `rootId` — groups every version of the same lineage. The first
  version's `rootId` equals its own `id`. Deliberately **not** a real
  Prisma/DB foreign key: the first version's row does not exist yet at
  INSERT time, so a same-row self-reference would need a two-phase
  insert-then-update for every single lineage just to satisfy a
  constraint that buys no integrity `previousVersionId` doesn't already
  give. Validated in the application/infrastructure layer instead
  (`PrismaPrescriptionRepository` is the only writer).
- `previousVersionId` — a real self-referencing FK to the exact
  predecessor (`ON DELETE SET NULL`), forming the chain.
- `version` — 1, 2, 3, ... within one `rootId`.

Rejected alternative: a separate `PrescriptionHistory` table populated on
every edit. Rejected because it under-models the lifecycle this phase
also needs (review state, reviewer identity, rejection reason all belong
*per version*, not bolted onto a mutable "current" row plus a diff log)
and duplicates data two ways for no query the one-row-per-version model
can't answer directly (`WHERE rootId = X ORDER BY version DESC LIMIT 1`
for "current", `WHERE rootId = X` for "history").

Current-version lookup: `WHERE status = 'APPROVED'` is the one row per
lineage callers actually want as "the" prescription; `listByCustomer`
returns every version so a client can render history if it chooses.

## 4. Lifecycle (Q2 workflow scope)

`DRAFT -> SUBMITTED -> UNDER_REVIEW -> {APPROVED | REJECTED}`,
`APPROVED -> SUPERSEDED` (see `PrescriptionStateMachine`, the same
`GRAPH`-based shape `OrderStateMachine`/`ReturnSettlementStateMachine`
already establish). `SUPERSEDED` has no direct entry point through the
state machine at all — it is reached only by
`PrismaPrescriptionRepository.approve()`'s own orchestration, acting on
the *previous* version when a *new* version in the same lineage is
approved. A same-status call is a no-op, not an error, same convention
every state machine in this repo follows.

Every transition goes through `PrescriptionService` (application layer)
and `PrismaPrescriptionRepository.transition()`/`.approve()`
(infrastructure layer) — never a raw CRUD update. `transition()` and
`approve()` both row-lock (`SELECT ... FOR UPDATE`) before asserting the
current status, the same technique `PrismaReturnSettlementRepository
.updateStatus()` already proved.

## 5. Versioning / immutability

Once a version reaches `APPROVED`, `REJECTED`, or `SUPERSEDED`
(`Prescription.isImmutable`), no route or use case can edit its
measurements. Correcting an approved prescription creates a **new**
`DRAFT` version in the same lineage (`PrescriptionService
.createNewVersion()`), which starts its own independent walk through the
same state machine. The predecessor is marked `SUPERSEDED` only when the
new version is actually `APPROVED` — not when it is merely created —
so an abandoned draft correction never silently invalidates a still-valid
approved prescription.

**Concurrency**: `prescriptions_one_approved_per_root` (partial unique
index, `WHERE status = 'APPROVED'`) is the real backstop, not application
locking alone — the same "constraint at the database, not only in
application code" convention Phase 010/013/021's own migrations already
follow. `approve()` supersedes the predecessor *before* approving the
target, in the same transaction, so the index never has to reconcile two
live `APPROVED` rows for one lineage. A concurrent second approval in the
same lineage loses the index race; Prisma's P2002 on that violation is
caught and re-thrown as `PrescriptionVersionConflictError` (409) — proven
by `customer.e2e-spec.ts`'s own concurrent-approval test, not assumed.

## 6. Customer profile & addresses

`Customer`/`CustomerAddress` already existed (Phase 004 schema) with no
application code reading/writing them until now. This phase adds only
what CP-019 needs: profile get/update (identity fields — `nationalId` —
deliberately excluded from the update surface), and full address CRUD
with default-address semantics:

- The first address a customer ever creates is always default,
  regardless of the caller's flag.
- Setting a later address default atomically clears every other default
  in the same transaction.
- Deleting the default address deterministically promotes the
  customer's next-most-recently-created remaining address.
- `customer_addresses_one_default_per_customer` (partial unique index,
  `WHERE is_default = true AND deleted_at IS NULL`) backstops "at most
  one default" against concurrent callers — this index did not exist
  before this phase (a plain `isDefault Boolean` column with no
  constraint).

Ownership is enforced in `CustomerAddressService`/`PrescriptionService`
(application layer), not by a route decorator — the same "self-service
resource, RBAC-free route, ownership checked by the use case" shape
`RevokeSessionUseCase` (`me/sessions`) already establishes. An id that
exists but belongs to another customer produces the same 404 an id that
doesn't exist at all would (`AddressOwnershipError`/
`PrescriptionOwnershipError`), so probing another customer's id is
indistinguishable from probing a nonexistent one.

## 7. Prescription numeric bounds (Q1 technical baseline)

`packages/validation/src/prescription.ts` already carried an explicit
`TODO(optometry-domain-expert)` and industry-standard-but-unreviewed
bounds before this phase — preserved verbatim, not deleted. This phase:

- Centralizes those bounds as `PRESCRIPTION_BOUNDS` (SPH ±20.00D/0.25
  step, CYL ±10.00D/0.25 step, AXIS 0-180°, ADD 0.00–+4.00D/0.25 step,
  PD 20-80mm) and reuses the constant from both the zod schema (DTO
  layer) and this migration's own CHECK constraints (persistence layer)
  — one number to change if a reviewer revises a bound, not two.
- Adds `CLINICAL_APPROVAL_STATUS = 'PENDING' as const` — a real, checked
  constant, not a comment, so nothing can silently start claiming
  approval.
- Stores every measurement as an integer centi-unit (`diopterToCenti`/
  `centiToDiopter`, ×100) — the same "no float for exact business-
  critical values" reasoning this repo's money columns (`BigInt`)
  already follow, so `-7.25D` is stored as `-725`, never a float that
  could drift under repeated arithmetic.
- AXIS is required whenever CYL is present, enforced at both the DTO
  layer (`eyeMeasurementSchema`'s own `.refine()`) and the database
  (`prescriptions_*_axis_requires_cyl` CHECK constraints).

## 8. Security posture (Q4 — encryption at rest)

This phase inspected the repository's existing security conventions
before deciding anything: every other schema in `schema.prisma` stores
sensitive-but-structured data (payment provider references, national
IDs) as plaintext columns with no field-level application encryption —
the repository's documented encryption capability
(`docs/security/README.md`) is scoped to password hashing, token/API-key
hashing, and one specific secret (`TwoFactorCredential.secretEncrypted`,
AES-256-GCM, `ENCRYPTION_KEY`), not a general "encrypt every sensitive
column" policy. Nothing in this repository documents a disk/volume-level
at-rest encryption guarantee either — that would be a deployment-target
property this codebase cannot itself assert, so this ADR does not claim
one. The only thing this phase asserts: encrypting prescription
measurements at the application level would be new precedent this
repository doesn't otherwise follow for structured-but-sensitive data,
not a continuation of an existing one.
Prescription measurements are **structured medical-adjacent data, not a
secret** in the same sense a 2FA seed or a password hash is — the
existing precedent for this class of data (national ID, payment
references) is infrastructure-level encryption, not per-field
application encryption.

This phase does not add custom application-level encryption for
prescription measurements. That decision is a **technical default**
reflecting existing infrastructure assumptions, not a security sign-off:
the final **Security Reviewer** decision on whether prescription data
specifically needs its own encryption boundary is recorded as PENDING
(`docs/product/phase-019-final-acceptance.md`, Q4). What this phase does
implement regardless of that outcome: authentication + ownership
authorization on every customer-facing route, `@RequirePermission`-gated
RBAC on every reviewer route (no new RBAC mechanism — reuses
`AuthorizationGuard`/`RequirePermission`), audit logging of every
meaningful action (`CustomerDomainExceptionFilter` maps every domain
error to a real 4xx so an expected failure is never an accidental 500),
and no prescription measurement values in ordinary application logs (the
audit log's own `newValue` fields for prescription actions carry only
lineage/version identifiers and status transitions, never SPH/CYL/AXIS/
ADD/PD values — see `docs/security/customer-security.md`).

## 9. Legal / Iran regulatory status (Q5)

No Iranian medical-device or prescription-handling regulation was found
cited anywhere in this repository's existing documentation, and this
phase does not search external sources or invent one. The implementation
is regulation-neutral: it stores measurement/order data with an explicit,
checked `CLINICAL_APPROVAL_STATUS = 'PENDING'` marker and makes no claim
of clinical or legal compliance anywhere in code, DTOs, or API responses.
`LEGAL_REVIEW_STATUS = PENDING` — tracked in
`docs/product/phase-019-final-acceptance.md`, not resolved here.

## 10. What CP-020 depends on

CP-020 is not implemented or unblocked by this ADR. Whatever CP-020's own
actual dependency policy is (per `docs/product/canonical-roadmap.md`)
governs whether it may proceed — this phase does not alter that policy or
CP-020's own status.
