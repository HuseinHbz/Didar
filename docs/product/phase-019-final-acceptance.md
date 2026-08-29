# CP-019 Final Human Acceptance Package

**This document is an acceptance package, NOT fabricated approval.**
Every "Status" field below reads `PENDING` because no human review has
actually occurred. Nothing in this document constitutes a domain,
clinical, security, or legal sign-off — only a named reviewer role,
acting outside this document, can change a status here, and only by
recording a dated decision, not by this file being edited.

## 0. Why this document exists alongside `phase-019-domain-review.md`

`docs/product/phase-019-domain-review.md` (the prior domain-review gate)
correctly found CP-019 `BLOCKED` on five unresolved human decisions and
refused to authorize implementation ahead of them. That refusal was
correct given the constraints it operated under. The project decision
that supersedes it for this phase, recorded here because it is the
reason this document exists: **implement the CP-019 technical/domain
foundation now, on an explicit technical baseline, and collect the five
approvals identified by the domain-review gate as a final acceptance
gate rather than a precondition to writing code.** That decision does
not retroactively make `phase-019-domain-review.md` wrong — it changes
what happens *next*. This document is that "next": a real technical
implementation exists (`services/api/src/modules/customer`,
`docs/adr/ADR-019-customer-domain-prescription.md`), and the same five
questions the domain-review gate posed are answered here with **what was
actually built**, not with a fabricated approval of it.

Governance facts unchanged by this document: no new CP, no new phase, no
second roadmap, no rename. CP-020 remains whatever
`docs/product/canonical-roadmap.md`'s own dependency policy says it is —
this document does not unblock it.

## 1. Q1 — Numeric bounds

- **Technical baseline**: `PRESCRIPTION_BOUNDS`
  (`packages/validation/src/prescription.ts`) — SPH ±20.00D (0.25 step),
  CYL ±10.00D (0.25 step), AXIS 0–180° (integer), ADD 0.00–+4.00D (0.25
  step), PD 20–80mm. Identical to the bounds
  `phase-019-domain-review.md` §4 Q1 already quoted as
  industry-default, not clinically reviewed — **unchanged in value**,
  only centralized and enforced twice (DTO layer + database CHECK
  constraints on `customer.prescriptions`) instead of documented once
  and enforced nowhere.
- **Evidence**: `packages/validation/src/prescription.ts` (constant +
  the original `TODO(optometry-domain-expert)`, preserved verbatim);
  `packages/database/prisma/migrations/20260829000000_customer_domain_prescription/migration.sql`
  (`prescriptions_*_range`/`prescriptions_*_axis_requires_cyl` CHECK
  constraints); `EyeMeasurementValidator`
  (`services/api/src/modules/customer/domain/services/`) is the one
  application-layer call site, so a future bounds revision changes one
  constant, not several call sites; `eye-measurement-validator.spec.ts`
  (10 unit tests) proves the bounds are actually enforced, not merely
  declared.
- `CLINICAL_APPROVAL_STATUS = 'PENDING' as const` — a real, checked
  constant every prescription API response echoes
  (`clinicalApprovalStatus`), not a comment.
- **Reviewer**: Optometry Domain Specialist.
- **Status**: `IMPLEMENTATION BASELINE READY / HUMAN CLINICAL REVIEW
  PENDING`.

## 2. Q2 — Review scope

- **Implemented scope**: a full reviewer workflow, not bounds-validation
  only — `DRAFT -> SUBMITTED -> UNDER_REVIEW -> {APPROVED | REJECTED}`,
  with a named reviewer identity (`reviewedByUserId`), a review-started
  timestamp, an approval/rejection timestamp, and a required rejection
  reason. This resolves `phase-019-domain-review.md` §4 Q2's "A vs. B"
  question in favor of B (full workflow) as the **technical**
  implementation choice — not as a substitute for the Product
  Manager + Optometry Domain Specialist's own scope decision, which
  remains open. If the eventual human decision is narrower (bounds
  validation only), the workflow states this phase added are a superset
  that can be left unused, not a rework.
- **Workflow decision**: `PrescriptionStateMachine`
  (`services/api/src/modules/customer/domain/services/`), backed by
  `admin/prescriptions/:id/{start-review,approve,reject}`
  (`customer.prescription.review` RBAC permission, `prescription_reviewer`
  role).
- **Reviewer**: Product Manager + Optometry Domain Specialist.
- **Status**: `IMPLEMENTED BASELINE / PRODUCT+OPTOMETRY REVIEW PENDING`.

## 3. Q3 — Prescription data model

- **Implemented data model**: one row per immutable version
  (`Prescription`, `customer.prescriptions`) — `rootId` groups a
  lineage, `previousVersionId` chains to the exact predecessor,
  `version` increments per lineage. This resolves
  `phase-019-domain-review.md` §4 Q3's "flat vs. blueprint's 5-table
  model" question with a third option: neither the single mutable flat
  row nor the blueprint's separate
  `prescriptions`/`prescription_versions`/`prescription_items`/
  `prescription_images`/`prescription_verifications` tables, but a
  normalized single-table-per-version model that gives immutable
  history, current-version lookup, and full review-lifecycle fields
  without the blueprint's extra tables (`prescription_images`,
  `prescription_verifications`) this phase's actual scope doesn't need.
- **Rationale**: full reasoning in
  `docs/adr/ADR-019-customer-domain-prescription.md` §3 — the flat model
  was rejected for destroying historical integrity on edit; the
  blueprint's 5-table model was rejected as over-modeling relative to
  what CP-019 actually requires (no separate image-attachment or
  third-party-verification subsystem exists yet to justify two of its
  five tables).
- **Reviewer**: Technical Architect + Product Manager + Optometry Domain
  Specialist.
- **Status**: `IMPLEMENTED / ARCHITECTURE+DOMAIN REVIEW PENDING`.

## 4. Q4 — Encryption at rest

- **Implemented security/encryption posture**: no application-level
  encryption of prescription measurement columns. Authentication +
  ownership authorization on every customer route, RBAC on every
  reviewer route, audit logging of every meaningful action with
  measurement values excluded from both audit payloads and ordinary
  logs, and two real Postgres constraints backstopping the module's
  concurrency-critical invariants. Full reasoning for the
  no-application-encryption default:
  `docs/adr/ADR-019-customer-domain-prescription.md` §8.
- **Evidence**: `docs/security/customer-security.md`;
  `services/api/src/modules/customer/presentation/filters/customer-domain-exception.filter.ts`
  (every domain error → real 4xx, never a 500 leaking detail);
  `services/api/src/modules/customer/application/*/*.service.ts`
  (`auditLog.record()` calls carry lineage/version/status only).
- **Reviewer**: Security Reviewer + Product Manager.
- **Status**: `IMPLEMENTED SECURITY POSTURE / SECURITY REVIEW PENDING`.

## 5. Q5 — Iran-specific regulatory requirements

- **Legal/regulatory assessment**: none performed by this phase beyond a
  repository-evidence search — no Iranian medical-device or
  prescription-handling regulation is cited anywhere in this codebase
  (`docs/`, `packages/`, `services/`), and none is invented here.
- **Evidence searched**: `docs/adr/`, `docs/product/*.md`,
  `docs/security/*.md`, `packages/validation/src/prescription.ts`'s own
  header (which states the general "the system must not invent medical
  diagnosis" principle, not a specific regulation) — same search scope
  `phase-019-domain-review.md` §3 already performed; re-run for this
  document, same null result.
- **Reviewer**: Legal/Regulatory Reviewer.
- **Status**: `LEGAL STATUS UNKNOWN / LEGAL REVIEW PENDING`.

## 6. What changes CP-019's status from here

CP-019's roadmap status (`docs/product/roadmap.json`,
`docs/product/canonical-roadmap.md`) reflects **implementation
complete, human acceptance pending** — see those documents' own CP-019
entries for the exact string used. It does not read `VALIDATED`, and
will not until Q1–Q5 above each carry a real reviewer name and date,
recorded by that reviewer, not inferred or fabricated by any future
engineering pass over this document.
