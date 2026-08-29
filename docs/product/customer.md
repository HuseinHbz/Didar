# Customer domain & prescription — product scope (CP-019)

Full architecture rationale: [`docs/adr/ADR-019-customer-domain-prescription.md`](../adr/ADR-019-customer-domain-prescription.md).
This document is the short "what does this phase actually deliver, and
what does it deliberately not" view, same role every prior phase's own
`docs/product/*.md` plays. Human/clinical/legal/security acceptance
status: [`docs/product/phase-019-final-acceptance.md`](./phase-019-final-acceptance.md)
— **PENDING**, not resolved by this phase's completion.

## What this phase delivers

- Self-service customer profile retrieval/update (`me/profile`) — the
  first application code in this repository to actually read/write
  `Customer`, which existed as a schema since Phase 004 but was
  previously only read for ownership checks.
- Full address CRUD (`me/addresses`) with deterministic default-address
  semantics: the first address is always default, a customer never ends
  up with addresses but no default, and a real Postgres partial unique
  index (not just application logic) guarantees at most one default per
  customer even under concurrent requests.
- A real prescription domain: DRAFT → SUBMITTED → UNDER_REVIEW →
  APPROVED/REJECTED lifecycle, one row per immutable version, a
  reviewer-gated approval workflow (`customer.prescription.review`
  RBAC permission, a dedicated `prescription_reviewer` role — never
  folded into `admin`), and a versioning model where correcting an
  approved prescription creates a new version rather than mutating
  history.
- A centralized, tested numeric validation baseline
  (`PRESCRIPTION_BOUNDS` in `@iecp/validation`) reused by both the DTO
  layer and the database's own CHECK constraints — replacing nothing
  (the prior file's `TODO(optometry-domain-expert)` is preserved
  verbatim), just making the existing bounds a single source of truth
  instead of an unenforced comment.
- Concurrency proven, not assumed: a real concurrent-approval race
  between two versions of the same prescription lineage is exercised in
  `test/customer.e2e-spec.ts` and resolves to exactly one `APPROVED`
  version, backstopped by a Postgres partial unique index.

## What this phase deliberately does not build

- **A diagnosis engine or any clinical judgement.** Prescription data is
  measurement/order information — SPH/CYL/AXIS/ADD/PD plus lifecycle
  metadata — never a computed or inferred medical assessment. See
  `packages/validation/src/prescription.ts`'s own header.
- **Clinical, legal, or security sign-off on this phase's own
  technical baseline.** `CLINICAL_APPROVAL_STATUS`/`LEGAL_REVIEW_STATUS`
  are explicit, checked `'PENDING'` constants — this phase implements a
  technical baseline for those approvals to later evaluate, it does not
  fabricate the approvals themselves.
- **Application-level encryption of prescription measurements.** A
  deliberate technical default pending the Security Reviewer's own
  decision (ADR-019 §8) — not silently resolved either way.
- **`FamilyMember`/`CustomerSegment`/`LoyaltyAccount`/`WalletAccount`
  functionality.** These models already exist (Phase 004) with their own
  existing application code where it exists — this phase touches only
  `Customer`/`CustomerAddress`/the new `Prescription` model, and does
  not duplicate or extend the others.
- **A frontend.** `apps/admin`/`apps/storefront`/`apps/pwa`/`apps/mobile`
  remain untouched, same precedent every backend phase has set.
