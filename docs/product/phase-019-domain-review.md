# CP-019 Domain Review

**This is a human decision gate, not a new canonical phase and not
feature implementation.** No new CP, phase, roadmap, or rename. No
Customer or Prescription domain code is authorized by this document.
Source: `docs/roadmap/master-roadmap-v2.md`, `## Track: Customer domain`,
`### P019 — Customer Domain & Prescription` — renumbered `CP-019` by
`canonical-roadmap.md` (content unchanged, only the ID prefix changes).

## 1. Status: **NO IMPLEMENTATION AUTHORIZED — CP-019 = BLOCKED**

CP-019 remains `BLOCKED` until all five decisions in §4 are formally
recorded with a dated, authoritative sign-off. This document records
what a human must decide — it does not decide it, does not mark CP-019
`IMPLEMENTED` or `VALIDATED`, and does not create an implementation
branch. Nothing in `packages/database/prisma/schema.prisma`,
`services/api/src/modules/`, or `packages/validation/src/prescription.ts`
is created or changed by this operation — the validator was read as
evidence only; its numeric bounds are **not** interpreted here as
medically correct and are **not** modified.

## Mission

Verbatim, `master-roadmap-v2.md` P019: "Build a real Customer domain
beyond auth — profile, address management (extending the existing thin
lookup), and a real Prescription entity — **gated on the existing
TODO's optometry-domain review, not built ahead of it**."

Acceptance criteria (verbatim):

1. A customer can attach a reviewed, valid prescription to an order line
2. The domain-expert review is a named, dated sign-off in the ADR for
   this phase — **this phase does not ship without it**

`risk: HIGH` — P019's own text: "the domain-expert-review dependency is
a real, non-technical blocker — do not let engineering timeline pressure
ship without it."

## 2. Current blocker

`packages/validation/src/prescription.ts:12-15` (unchanged by this
operation, quoted verbatim):

> `TODO(optometry-domain-expert): the numeric bounds and step below are
reasonable industry defaults, not a clinically reviewed spec. Confirm
before this ships in a real order flow — see docs/product/blueprint.md
§21 and §121 (Optometry Domain Specialist role).`

A human decision, not a missing technical dependency (§3).

## 3. Evidence

**Git** (re-verified live this operation):

| Check                                                                                      | Result                                                                                                            |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Current branch                                                                             | `develop`                                                                                                         |
| `develop` HEAD (local == origin, tree clean)                                               | `23872943e4660304e90f06754a322073b8ec2aa9`                                                                        |
| `git merge-base --is-ancestor origin/16-feature-platform-reliability origin/develop`       | `true` — **CP-016 MERGED**                                                                                        |
| `git merge-base --is-ancestor origin/18-feature-admin-panel-mvp origin/develop`            | `true` — **CP-018 MERGED**                                                                                        |
| `git merge-base --is-ancestor origin/21-feature-procurement origin/develop`                | `true` — **CP-021 MERGED**                                                                                        |
| `git merge-base --is-ancestor origin/17-feature-real-notification-delivery origin/develop` | `false` — **CP-017 NOT merged** (remains `IMPLEMENTED / VALIDATION-BLOCKED`, see `phase-017-validation-audit.md`) |
| Any CP-019 implementation branch, local or remote                                          | **none exists**                                                                                                   |
| CP-020 dependency (`roadmap.json`: `["CP-016","CP-018","CP-019"]`)                         | CP-016/CP-018 satisfied, CP-019 not — **CP-020 remains BLOCKED**                                                  |
| CP-022 dependency (`roadmap.json`: `["CP-018","CP-020"]`)                                  | CP-018 satisfied, CP-020 not — **CP-022 remains transitively BLOCKED**                                            |

CP-019's two canonical dependencies (CP-015, CP-016) are both
`VALIDATED` and merged. **The blocker is exclusively the domain-expert-
review gate — no unmet technical dependency exists.**

**Current implementation evidence:**

| Item                                                       | Exists?                                 | Evidence                                                                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Prescription` Prisma model                                | **No**                                  | `grep -n "^model Prescription" packages/database/prisma/schema.prisma` — zero matches                                                                                                 |
| Dedicated `customer` module in `services/api/src/modules/` | **No**                                  | `ls services/api/src/modules/` → `cart-checkout, catalog, health, identity, inventory, order, payment, promotion, return`                                                             |
| `Customer` / `CustomerAddress` schema                      | Yes, schema only, one read-only caller  | `schema.prisma:377`/`:399`; only caller: `cart-checkout`'s read-only `PrismaCustomerLookupRepository`                                                                                 |
| `FamilyMember` / `LoyaltyAccount` / `WalletAccount` schema | Yes, schema only, zero application code | `schema.prisma:424`/`:473`/`:504`; zero hits across `services/api/src`                                                                                                                |
| Prescription value-bounds validator                        | Yes, explicitly unreviewed              | `packages/validation/src/prescription.ts` (§2, quoted verbatim, unchanged)                                                                                                            |
| Prescription _reference_ validator                         | Yes, explicitly incomplete by design    | `cart-checkout/domain/services/prescription-reference-validator.ts` — returns `'unverified'`, never a fabricated `'valid'`                                                            |
| Any ADR for CP-019, or any recorded domain-expert sign-off | **No**                                  | `ls docs/adr/` — no CP-019/customer/prescription entry. `ADR-007` decision 9 / `ADR-009` decision 5 are the same self-documented "not built yet" disclosures — neither is a sign-off. |

**Search performed this operation** for any authoritative decision on
Q1–Q5 anywhere in the repository (`docs/adr/`, product/security/
governance docs, decision records): `grep -rli "approved\|sign-off\|
signed off\|dated.*review\|decision record"` across `docs/adr/` and
`docs/product/*.md` returns hits only for _other_ CPs' own ADRs
(catalog, returns, procurement, etc.) and this file's own prior
revisions — **none for CP-019**. A mention is not an approval, a TODO is
not an approval, and no prior assistant statement is treated as one — no
authoritative decision record for any of Q1–Q5 exists.

## 4. Decision Matrix

Exactly five decisions. None is answered here — a mention is not an
approval; only an authoritative, dated, reviewer-attributed record would
count, and none exists (§3).

### Q1 — Numeric bounds

**Question:** Are the numeric bounds in `packages/validation/src/prescription.ts`
approved by the appropriate Optometry Domain Specialist? (Bounds,
verbatim, unchanged by this operation: SPH ±20.00D/0.25 steps; CYL
±10.00D/0.25 steps; AXIS 0–180° int; ADD 0.00–+4.00D/0.25 steps; PD
20–80mm.)
**Possible outcomes:** A = APPROVED · B = APPROVED WITH CHANGES ·
C = REJECTED · D = HUMAN REVIEW REQUIRED

| Field              | Value                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Decision           | **D — HUMAN REVIEW REQUIRED** (no signed decision exists — this is the default, not a finding) |
| Evidence           | `packages/validation/src/prescription.ts:12-15`, self-labeled `TODO(optometry-domain-expert)`  |
| Decision authority | Optometry Domain Specialist                                                                    |
| Reviewer           | _(unassigned — no named individual exists in the repository)_                                  |
| Date               | _(none — no decision recorded)_                                                                |
| Source document    | _(none exists)_                                                                                |
| Approval status    | **UNRESOLVED**                                                                                 |

### Q2 — Review scope

**Question:** What does "domain review" mean for CP-019?
**Possible outcomes:** A = Bounds/schema validation only · B = Full
Optometrist Review workflow · C = Other explicitly defined scope ·
D = HUMAN DECISION REQUIRED

| Field              | Value                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision           | **D — HUMAN DECISION REQUIRED**                                                                                                                                                                                                                                                                                                                           |
| Evidence           | P019's own deliverable text names only bounds review (would support A); `blueprint.md` §21 (lines 4396–4444) separately describes a full per-prescription Approved/Rejected/Need-More-Info workflow (would support B). Neither document resolves which CP-019 must build — B is **not** inferred merely because the blueprint mentions a review workflow. |
| Decision authority | Product Manager + Optometry Domain Specialist (domain scope affected)                                                                                                                                                                                                                                                                                     |
| Reviewer           | _(unassigned)_                                                                                                                                                                                                                                                                                                                                            |
| Date               | _(none)_                                                                                                                                                                                                                                                                                                                                                  |
| Source document    | _(none exists)_                                                                                                                                                                                                                                                                                                                                           |
| Approval status    | **UNRESOLVED**                                                                                                                                                                                                                                                                                                                                            |

### Q3 — Prescription data model

**Question:** Which Prescription model is approved?
**Possible outcomes:** A = Flat Prescription entity · B = Blueprint's
versioned multi-table model · C = Other explicitly approved model ·
D = HUMAN DECISION REQUIRED

| Field              | Value                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision           | **D — HUMAN DECISION REQUIRED**                                                                                                                                                                                                                                                                                                        |
| Evidence           | P019's deliverable text implies A ("Prescription domain entity + migration"); `blueprint.md` §20 (lines 4391–4400) lists a 5-table model (`prescriptions`/`prescription_versions`/`prescription_items`/`prescription_images`/`prescription_verifications`) implying B. Not chosen on implementation convenience — neither implemented. |
| Decision authority | Product Manager + Technical Architect + Optometry Domain Specialist                                                                                                                                                                                                                                                                    |
| Reviewer           | _(unassigned)_                                                                                                                                                                                                                                                                                                                         |
| Date               | _(none)_                                                                                                                                                                                                                                                                                                                               |
| Source document    | _(none exists)_                                                                                                                                                                                                                                                                                                                        |
| Approval status    | **UNRESOLVED**                                                                                                                                                                                                                                                                                                                         |

### Q4 — Encryption at rest

**Question:** What is required for Prescription data at rest?
**Possible outcomes:** A = Mandatory encryption · B = Security
evaluation only, decision documented · C = Other explicitly approved
requirement · D = HUMAN DECISION REQUIRED

| Field              | Value                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision           | **D — HUMAN DECISION REQUIRED**                                                                                                                                                                                                                                                                                                                                                                       |
| Evidence           | P019's own `security_requirements` text: "encryption-at-rest **evaluated explicitly**" — says "evaluated," not "required" or "mandatory." Not decided technically here without the required reviewer. (Not part of the decision: `services/api`'s identity module already has a reusable `ENCRYPTION_KEY` utility if the outcome is "encrypt" — a technical fact, not a substitute for the decision.) |
| Decision authority | Security Reviewer + Product Manager                                                                                                                                                                                                                                                                                                                                                                   |
| Reviewer           | _(unassigned)_                                                                                                                                                                                                                                                                                                                                                                                        |
| Date               | _(none)_                                                                                                                                                                                                                                                                                                                                                                                              |
| Source document    | _(none exists)_                                                                                                                                                                                                                                                                                                                                                                                       |
| Approval status    | **UNRESOLVED**                                                                                                                                                                                                                                                                                                                                                                                        |

### Q5 — Iran-specific regulatory requirements

**Question:** Has an applicable Iran-specific legal/regulatory
requirement been identified for the Prescription/Customer domain?
**Possible outcomes:** A = Yes, requirement explicitly documented ·
B = No applicable requirement identified · C = UNKNOWN / LEGAL REVIEW
REQUIRED

| Field              | Value                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision           | **C — UNKNOWN / LEGAL REVIEW REQUIRED** (default; not invented)                                                                                                                                                                                                 |
| Evidence           | Repository states only the general principle, `blueprint.md:4435` (verbatim): "سیستم نباید تشخیص پزشکی اختراع کند" ("the system must not invent medical diagnosis"). No specific regulation, medical-device classification, or licensing law is cited anywhere. |
| Decision authority | Legal/Regulatory Reviewer, when required                                                                                                                                                                                                                        |
| Reviewer           | _(unassigned — conditional on this decision's own eventual outcome)_                                                                                                                                                                                            |
| Date               | _(none)_                                                                                                                                                                                                                                                        |
| Source document    | _(none exists)_                                                                                                                                                                                                                                                 |
| Approval status    | **UNRESOLVED**                                                                                                                                                                                                                                                  |

**A developer cannot self-approve a domain decision — none of the above
was resolved by engineering judgment.**

## 5. CP-019 unblock gate

CP-019 may transition from `BLOCKED` only when **all** of the following
are true:

1. Q1 has an authoritative decision
2. Q2 has an authoritative decision
3. Q3 has an authoritative decision
4. Q4 has an authoritative decision
5. Q5 has an authoritative decision or documented legal determination
6. Decisions have identifiable reviewers
7. Decisions have dates
8. Decisions are recorded in an authoritative ADR/decision record
9. No contradiction exists with `canonical-roadmap.md`
10. No implementation has started before approval

**All ten conditions currently fail.** CP-019 remains `BLOCKED`.

## 6. Governance consistency

Re-verified live, this operation (§3): CP-020 remains `BLOCKED` on
CP-019; CP-022 remains transitively `BLOCKED` via CP-020; CP-017 remains
`IMPLEMENTED / VALIDATION-BLOCKED`, not merged; CP-016, CP-018, CP-021
remain `VALIDATED` and merged. No new CP or phase introduced. No second
roadmap exists (`grep -c '"id": "CP-019"' roadmap.json` → 1, no
duplicate). CP-020/CP-022 status is unchanged — no contradiction with
CP-019's own status was found that would require changing either.

**Not rewritten** (unrelated to CP-019, out of this gate's scope):
`docs/product/canonical-roadmap.md`'s summary table still carries stale
pre-merge statuses for five unrelated phases (CP-012/013/015/016/017),
first reported in `docs/product/phase-017-validation-audit.md`. Does not
touch CP-019's own row ("BLOCKED (needs domain-expert review)" —
accurate); correcting five unrelated phases' history is not required for
CP-019 consistency and is left untouched.

## 7. Next execution unit

Hand §4's five questions to a human Optometry Domain Specialist (joined
by the Product Manager and Technical Architect for Q2/Q3, the Security
Reviewer for Q4, and conditionally a Legal/Regulatory Reviewer if Q5
surfaces a real requirement). No engineering action starts CP-019,
CP-020, or CP-022 until §5's ten conditions are met.
