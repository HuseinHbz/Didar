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
what happens _next_. This document is that "next": a real technical
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

## 7. Acceptance evidence matrix

The original question wording, decision authority, and possible outcome
codes below are reproduced verbatim from
`docs/product/phase-019-domain-review.md` §4 — this table does not
restate the decision, it indexes it against what §1–§5 above actually
built. **Engineering Status** records what is technically verified.
**Human Decision** and **Status** stay `PENDING`/blank because no human
review has occurred — this table is a discovery artifact, not an
approval, exactly like the rest of this document (§0).

| Gate | Question (verbatim, `phase-019-domain-review.md` §4)                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                      | Engineering Status                                                                                                                                                                                                                                                                                                                                                                                                                                     | Human Decision    | Reviewer       | Date | Status                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------- | ---- | -------------------------------------- |
| Q1   | Are the numeric bounds in `packages/validation/src/prescription.ts` approved by the appropriate Optometry Domain Specialist? (SPH ±20.00D/0.25; CYL ±10.00D/0.25; AXIS 0–180° int; ADD 0.00–+4.00D/0.25; PD 20–80mm.) Outcomes: A=APPROVED · B=APPROVED WITH CHANGES · C=REJECTED · D=HUMAN REVIEW REQUIRED | `packages/validation/src/prescription.ts:12-15` (`TODO(optometry-domain-expert)`, unchanged in value); `eye-measurement-validator.spec.ts` (10 unit tests); migration `20260829000000_customer_domain_prescription/migration.sql` CHECK constraints; §1 above                                                                                 | Bounds centralized in one constant, enforced at both the DTO layer and a real Postgres CHECK constraint (not merely documented), one application-layer call site (`EyeMeasurementValidator`), 10 passing unit tests proving enforcement. `clinicalApprovalStatus` field is a real, checked `'PENDING'` constant every API response echoes — not a comment.                                                                                             | _(none recorded)_ | _(unassigned)_ | —    | **CONDITIONAL ACCEPTANCE** (§9)        |
| Q2   | What does "domain review" mean for CP-019? Outcomes: A=Bounds/schema validation only · B=Full Optometrist Review workflow · C=Other explicitly defined scope · D=HUMAN DECISION REQUIRED                                                                                                                    | `PrescriptionStateMachine`; `admin/prescriptions/:id/{start-review,approve,reject}`; `customer.prescription.review` permission, `prescription_reviewer` role; §2 above; live-verified this session (start-review → UNDER_REVIEW → approve → APPROVED, real `reviewedByUserId`)                                                                | Full workflow (outcome B) built as the **technical** implementation choice, not as a substitute for the Product Manager + Optometry Domain Specialist's own scope decision. If the eventual human decision is narrower (A), the extra workflow states are an unused superset, not a rework.                                                                                                                                                            | _(none recorded)_ | _(unassigned)_ | —    | **ACCEPTABLE FOR HUMAN SIGN-OFF** (§9) |
| Q3   | Which Prescription model is approved? Outcomes: A=Flat entity · B=Blueprint's versioned multi-table model · C=Other explicitly approved model · D=HUMAN DECISION REQUIRED                                                                                                                                   | `docs/adr/ADR-019-customer-domain-prescription.md` §3; `Prescription` model (`customer.prescriptions`, `rootId`/`previousVersionId`/`version`); §3 above                                                                                                                                                                                      | A third option (outcome C) — one-row-per-immutable-version, not outcome A (flat, rejected for destroying history) or outcome B (blueprint's 5-table model, rejected as over-modeling relative to this phase's actual scope). Full rationale recorded in the ADR, not decided on implementation convenience alone.                                                                                                                                      | _(none recorded)_ | _(unassigned)_ | —    | **ACCEPTABLE FOR HUMAN SIGN-OFF** (§9) |
| Q4   | What is required for Prescription data at rest? Outcomes: A=Mandatory encryption · B=Security evaluation only, decision documented · C=Other explicitly approved requirement · D=HUMAN DECISION REQUIRED                                                                                                    | `docs/security/customer-security.md`; `docs/adr/ADR-019-customer-domain-prescription.md` §8; `customer-domain-exception.filter.ts` (every domain error → real 4xx, never a 500 leaking detail); audit-log calls carry lineage/version/status only — live-verified this session (no measurement values in `system.audit_logs` or process logs) | No application-level encryption of measurement columns implemented; authentication + ownership authorization on every customer route, RBAC on every reviewer route, audit logging with measurement values excluded, live-confirmed. This is the **evaluation** the original question required (outcome B's evidence half) — it is not itself the outcome-B decision, which still needs a named Security Reviewer + Product Manager to actually record. | _(none recorded)_ | _(unassigned)_ | —    | **CONDITIONAL ACCEPTANCE** (§9)        |
| Q5   | Has an applicable Iran-specific legal/regulatory requirement been identified for the Prescription/Customer domain? Outcomes: A=Yes, requirement explicitly documented · B=No applicable requirement identified · C=UNKNOWN / LEGAL REVIEW REQUIRED                                                          | Repository-wide re-search this phase and the domain-review gate both performed (`docs/adr/`, `docs/product/*.md`, `docs/security/*.md`, `packages/validation/src/prescription.ts` header) — same null result both times                                                                                                                       | No Iranian medical-device or prescription-handling regulation is cited anywhere in this codebase. Re-searching cannot change this into a legal determination — only a Legal/Regulatory Reviewer can.                                                                                                                                                                                                                                                   | _(none recorded)_ | _(unassigned)_ | —    | **LEGAL REVIEW REQUIRED** (§9)         |

**Every gate above requires clinical, product, architectural, security,
or legal judgment a repository search cannot supply — none is an
objective engineering check, so none is marked technically satisfied
under Phase 4 of this operation's own instructions.** All five remain
`HUMAN DECISION REQUIRED`, unchanged from
`phase-019-domain-review.md`'s own original classification.

## 8. Human Acceptance Required

Every field below defaults to `PENDING`. Only a named reviewer, acting
outside this document and recording a dated decision, may change one —
never a future engineering pass over this file.

### Q1 — Prescription numeric bounds

1. **Decision required**: Approve, revise, or reject SPH/CYL/AXIS/ADD/PD
   bounds and step sizes as clinically safe defaults.
2. **Why engineering cannot decide**: These are medical/optometric
   values; no clinical training or licensure exists in this codebase or
   its authors to validate them.
3. **Evidence available**: `packages/validation/src/prescription.ts`,
   `eye-measurement-validator.spec.ts`, §1/§7 above.
4. **Exact decision choices**: `ACCEPTED` / `REJECTED` /
   `CHANGES_REQUESTED` / `PENDING`.
5. **Required reviewer role**: Optometry Domain Specialist.
6. **Approval field**: `PENDING`
7. **Date field**: `—`

### Q2 — Review scope

1. **Decision required**: Confirm the full reviewer workflow (built) is
   the intended scope, or that a narrower bounds-only check would have
   sufficed.
2. **Why engineering cannot decide**: A product-scope and clinical-
   process question, not a technical one.
3. **Evidence available**: `PrescriptionStateMachine`, the
   `admin/prescriptions/:id/{start-review,approve,reject}` routes, §2/§7
   above.
4. **Exact decision choices**: `ACCEPTED` / `REJECTED` /
   `CHANGES_REQUESTED` / `PENDING`.
5. **Required reviewer role**: Product Manager + Optometry Domain
   Specialist.
6. **Approval field**: `PENDING`
7. **Date field**: `—`

### Q3 — Prescription data model

1. **Decision required**: Approve the one-row-per-immutable-version
   model, or require the blueprint's 5-table model, or another model.
2. **Why engineering cannot decide**: A durable data-architecture and
   product decision with long-term migration cost either way; ADR-019
   records the engineering rationale but not sign-off authority.
3. **Evidence available**: `docs/adr/ADR-019-customer-domain-prescription.md`
   §3, the `Prescription` model itself, §3/§7 above.
4. **Exact decision choices**: `ACCEPTED` / `REJECTED` /
   `CHANGES_REQUESTED` / `PENDING`.
5. **Required reviewer role**: Technical Architect + Product Manager +
   Optometry Domain Specialist.
6. **Approval field**: `PENDING`
7. **Date field**: `—`

### Q4 — Encryption at rest

1. **Decision required**: Confirm the no-application-level-encryption
   default (with authorization/RBAC/audit-log-redaction as the actual
   controls in place) is an acceptable security posture, or require
   encryption.
2. **Why engineering cannot decide**: A risk-acceptance decision that
   trades real implementation cost against a threat model this repo has
   not had a Security Reviewer formally sign off on.
3. **Evidence available**: `docs/security/customer-security.md`,
   `docs/adr/ADR-019-customer-domain-prescription.md` §8, the live
   audit-log verification in §7 above.
4. **Exact decision choices**: `ACCEPTED` / `REJECTED` /
   `CHANGES_REQUESTED` / `PENDING`.
5. **Required reviewer role**: Security Reviewer + Product Manager.
6. **Approval field**: `PENDING`
7. **Date field**: `—`

### Q5 — Iran-specific regulatory requirements

1. **Decision required**: Confirm no applicable Iran-specific
   prescription/medical-device regulation exists, or identify one that
   does.
2. **Why engineering cannot decide**: A legal determination; a
   repository text search proves absence-of-mention, not absence-of-
   requirement.
3. **Evidence available**: the repeated repository-wide search recorded
   in §5/§7 above (same null result across two independent operations).
4. **Exact decision choices**: `ACCEPTED` (no requirement applies) /
   `REJECTED` (a requirement applies and blocks as-built) /
   `CHANGES_REQUESTED` / `PENDING`.
5. **Required reviewer role**: Legal/Regulatory Reviewer.
6. **Approval field**: `PENDING`
7. **Date field**: `—`

## 9. Recorded acceptance framing (project owner, 2026-09-01)

The project owner recorded the refined framing below for each gate on
2026-09-01. **This is a decision framework, not a signed approval**: no
named individual acting in any of the five required reviewer roles is
recorded, and no `ACCEPTED`/`REJECTED` outcome exists for any gate. §7's
`Reviewer`/`Date` columns and §8's `Approval field`/`Date field` for
every Q therefore still correctly read `_(unassigned)_`/`—`/`PENDING` —
this section sharpens what each gate's Status/Condition is while that
remains true, it does not change it. Only a named reviewer recording an
actual dated decision changes those fields.

### Q1 — Prescription numeric bounds

- **Status**: `CONDITIONAL ACCEPTANCE`
- **Required approver**: Optometry Domain Specialist
- **Condition**: Clinical validity of SPH/CYL/AXIS/ADD/PD ranges and
  precision must be explicitly confirmed against an authoritative
  optometry clinical reference before this condition can be lifted.

### Q2 — Review workflow

- **Status**: `ACCEPTABLE FOR HUMAN SIGN-OFF`
- **Required approvers**: Product Manager, Optometry Domain Specialist
- **Decision to confirm**: workflow states, reviewer scope, approval
  authority, post-submit immutability, and revision behavior.

### Q3 — Immutable prescription versioning

- **Status**: `ACCEPTABLE FOR HUMAN SIGN-OFF`
- **Required approvers**: Technical Architect, Product Manager,
  Optometry Domain Specialist
- **Decision to confirm**: immutable version lineage, approval-to-
  version binding, auditability, and revision semantics.

### Q4 — Security / encryption at rest

- **Status**: `CONDITIONAL ACCEPTANCE`
- **Required approvers**: Security Reviewer, Product Manager
- **Condition**: confirm data classification and production controls
  for database/storage encryption at rest, backup encryption, key
  management, access control, and audit protection. Application-level
  encryption is **not** automatically required unless the risk
  assessment determines it necessary.

### Q5 — Iran regulatory compliance

- **Status**: `LEGAL REVIEW REQUIRED` (unchanged)
- **Required approver**: Legal/Regulatory Reviewer
- **Decision to confirm**: compliance with applicable Iranian
  healthcare, professional-confidentiality, privacy, electronic-health,
  and data-retention/access requirements for the actual business model.
