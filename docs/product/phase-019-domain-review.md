# CP-019 Domain Review

**This is a human decision gate, not a new canonical phase and not
feature implementation.** No new CP, phase, roadmap, or rename. No
Customer or Prescription domain code is authorized by this document.
Source: `docs/roadmap/master-roadmap-v2.md`, `## Track: Customer domain`,
`### P019 — Customer Domain & Prescription` — renumbered `CP-019` by
`canonical-roadmap.md` (content unchanged, only the ID prefix changes).

## 1. Status: **NO IMPLEMENTATION AUTHORIZED**

**CP-019 = BLOCKED**, and remains `BLOCKED` until all five decisions in
§4 are formally recorded with a dated, authoritative sign-off. This
document records what a human must decide — it does not decide it, does
not mark CP-019 `IMPLEMENTED` or `VALIDATED`, and does not create an
implementation branch. Nothing in `packages/database/prisma/schema.prisma`,
`services/api/src/modules/`, or `packages/validation/src/prescription.ts`
is created or changed by this operation — the validator was read as
evidence only; its numeric bounds are **not** interpreted here as
medically correct, and it is **not** modified.

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

This is the single named, canonical blocker — a human decision, not a
missing technical dependency (§3).

## 3. Evidence

**Git** (re-verified live this operation):

| Check                                                                                      | Result                                                                                                            |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Current branch                                                                             | `develop`                                                                                                         |
| `develop` HEAD (local == origin, tree clean)                                               | `cd710d8e3799a75b3d029a6a7420bbab306f8bd1`                                                                        |
| `git merge-base --is-ancestor origin/15-feature-integration-reconciliation origin/develop` | `true` — **CP-015 MERGED**                                                                                        |
| `git merge-base --is-ancestor origin/16-feature-platform-reliability origin/develop`       | `true` — **CP-016 MERGED**                                                                                        |
| `git merge-base --is-ancestor origin/18-feature-admin-panel-mvp origin/develop`            | `true` — **CP-018 MERGED**                                                                                        |
| `git merge-base --is-ancestor origin/21-feature-procurement origin/develop`                | `true` — **CP-021 MERGED**                                                                                        |
| `git merge-base --is-ancestor origin/17-feature-real-notification-delivery origin/develop` | `false` — **CP-017 NOT merged** (remains `IMPLEMENTED / VALIDATION-BLOCKED`, see `phase-017-validation-audit.md`) |
| Any CP-019 implementation branch, local or remote                                          | **none exists**                                                                                                   |
| CP-020 dependency check (`roadmap.json`: `["CP-016","CP-018","CP-019"]`)                   | CP-016/CP-018 satisfied, CP-019 not — **CP-020 remains BLOCKED**                                                  |
| CP-022 dependency check (`roadmap.json`: `["CP-018","CP-020"]`)                            | CP-018 satisfied, CP-020 not — **CP-022 remains transitively BLOCKED**                                            |

CP-019's two canonical dependencies (CP-015, CP-016) are both
`VALIDATED` and merged. **The blocker is exclusively the domain-expert-
review gate — no unmet technical dependency exists.**

**Current implementation evidence** (verified through source, not
inferred from a similarly-named table):

| Item                                                       | Exists?                                 | Evidence                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Prescription` Prisma model                                | **No**                                  | `grep -n "^model Prescription" packages/database/prisma/schema.prisma` — zero matches                                                                                                                                                                                                                    |
| Dedicated `customer` module in `services/api/src/modules/` | **No**                                  | `ls services/api/src/modules/` → `cart-checkout, catalog, health, identity, inventory, order, payment, promotion, return`                                                                                                                                                                                |
| `Customer` / `CustomerAddress` schema                      | Yes, schema only, one read-only caller  | `schema.prisma:377`/`:399`; only caller: `cart-checkout`'s read-only `PrismaCustomerLookupRepository`                                                                                                                                                                                                    |
| `FamilyMember` / `LoyaltyAccount` / `WalletAccount` schema | Yes, schema only, zero application code | `schema.prisma:424`/`:473`/`:504`; zero hits across `services/api/src`                                                                                                                                                                                                                                   |
| Prescription value-bounds validator                        | Yes, explicitly unreviewed              | `packages/validation/src/prescription.ts` (§2, quoted verbatim, unchanged)                                                                                                                                                                                                                               |
| Prescription _reference_ validator                         | Yes, explicitly incomplete by design    | `cart-checkout/domain/services/prescription-reference-validator.ts` — returns `'unverified'`, never a fabricated `'valid'`                                                                                                                                                                               |
| Any ADR for CP-019, or any recorded domain-expert sign-off | **No**                                  | `ls docs/adr/` — no CP-019/customer/prescription entry. The only two existing ADR mentions of "prescription" (`ADR-007` decision 9, `ADR-009` decision 5) are both the same class of self-documented "not built yet, no fabricated value" disclosure already cited above — neither is a domain sign-off. |

**Documentation** — `roadmap.json`, `canonical-roadmap.md`,
`phase-dependency-graph.md`, `gap-priority-matrix.md`,
`requirements-matrix.md`, `project-progress.md`, `PROJECT_STATUS.md` all
agree CP-019 is `BLOCKED`, `0%` implemented, no branch. No document
claims otherwise.

## 4. Q1–Q5 Decision Table

The only five decisions this gate covers. None is answered by this
operation; each records only what the repository already contains.

| #      | Question                                                                                                                                                                                                                                                                                         | Allowed outcomes                                                                           | Repository evidence                                                                                                                                                                                                                                                                                                                                                                                                | Decision found in repo? | **Recorded outcome**                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------ |
| **Q1** | Are the current prescription numeric bounds medically/domain-correct? Bounds (verbatim, `packages/validation/src/prescription.ts`, unchanged): SPH ±20.00D/0.25 steps; CYL ±10.00D/0.25 steps; AXIS 0–180° int; ADD 0.00–+4.00D/0.25 steps; PD 20–80mm (binocular 50–75/monocular 25–40 per eye) | A — APPROVED · B — REJECTED · C — NEEDS REVISION · D — HUMAN REVIEW REQUIRED               | Self-labeled `TODO(optometry-domain-expert)`; "reasonable industry defaults, not a clinically reviewed spec"                                                                                                                                                                                                                                                                                                       | No                      | **D — HUMAN REVIEW REQUIRED** (default; no signed decision exists) |
| **Q2** | What is the intended CP-019 review scope?                                                                                                                                                                                                                                                        | A — Bounds validation only · B — Full Optometrist Review workflow/domain · C — Other       | P019's own deliverable text names only bounds review (A); `blueprint.md` §21 (lines 4396–4444) separately describes a per-prescription Approved/Rejected/Need-More-Info workflow (B). Neither document resolves which CP-019 must build.                                                                                                                                                                           | No                      | **HUMAN DECISION REQUIRED**                                        |
| **Q3** | Which Prescription data model is approved?                                                                                                                                                                                                                                                       | A — Flat `Prescription` entity · B — Blueprint's versioned multi-table model · C — Other   | P019's deliverable text implies A ("Prescription domain entity + migration"); `blueprint.md` §20 (lines 4391–4400) lists a 5-table model (`prescriptions`/`prescription_versions`/`prescription_items`/`prescription_images`/`prescription_verifications`) implying B. Not chosen here on implementation convenience — no repository text picks one.                                                               | No                      | **HUMAN DECISION REQUIRED**                                        |
| **Q4** | What is the approved security requirement for Prescription data at rest?                                                                                                                                                                                                                         | A — Mandatory encryption at rest · B — Evaluate/recommend only · C — Other                 | P019's own `security_requirements` text: "encryption-at-rest **evaluated explicitly**" — says "evaluated," not "required." Whether the evaluation's outcome must be "yes" is not stated. (Not part of the decision: `services/api`'s identity module already has a reusable `ENCRYPTION_KEY` utility, so if the outcome is "encrypt," the mechanism exists — a technical fact, not a substitute for the decision.) | No                      | **HUMAN DECISION REQUIRED**                                        |
| **Q5** | Are there applicable Iran-specific legal/regulatory requirements that materially affect the Prescription/Customer domain?                                                                                                                                                                        | A — Yes (record exact requirement + source) · B — No · C — Unknown / legal review required | Repository states only the general principle (`blueprint.md:4435`, verbatim: "سیستم نباید تشخیص پزشکی اختراع کند" — "the system must not invent medical diagnosis"). **No specific regulation, medical-device classification, or licensing law is cited anywhere.** Not invented here.                                                                                                                             | No                      | **C — UNKNOWN / LEGAL REVIEW REQUIRED** (default)                  |

## 5. Decision status

All five: **not resolved**. No signed/authoritative human decision for
any of Q1–Q5 was found anywhere in `docs/`, `docs/adr/`, or any decision/
governance record (§3's ADR search). Nothing is fabricated in its place.

## 6. Required reviewers

Recorded exactly per this operation's own assignment — no named
individuals are claimed to have approved anything; only roles are
recorded, and only because the repository's own text supports each
assignment (§3):

- **Q1:** Optometry Domain Specialist
- **Q2:** Product Manager + Optometry Domain Specialist
- **Q3:** Product Manager + Optometry Domain Specialist
- **Q4:** Security Reviewer
- **Q5:** Legal/Regulatory Reviewer if required (conditional on Q5's own
  eventual answer — nothing in the repository currently establishes that
  a specific regulation applies, so this reviewer is not asserted as
  needed outright, only as the correct escalation path if outcome A or C
  surfaces a real requirement)

## 7. Explicit implementation prohibition

**No implementation branch may be created by this or any preceding
operation.** No `Prescription` model, migration, controller, use case,
or UI may be written until §8's criteria are met. `packages/validation/src/prescription.ts`
is not modified by this document — it remains exactly as evidence, not
as an approved spec.

## 8. Unblock criteria

CP-019 may move from `BLOCKED` to implementation-ready only when **all**
of the following are true:

1. Q1 has an explicit human decision (not the D default).
2. Q2 has an explicit scope decision (not left unresolved).
3. Q3 has an explicit data-model decision (not left unresolved).
4. Q4 has an explicit security decision (not left unresolved).
5. Q5 has an explicit regulatory disposition (not left at the C default,
   unless "C, no regulation applies after review" is itself the final,
   dated answer).
6. Decisions are recorded in an authoritative ADR/decision record.
7. The decision record has a date.
8. Required reviewers (§6) are identified by name/role in that record.
9. No unresolved contradiction exists between the decision record and
   the canonical roadmap.

Until then: **NO IMPLEMENTATION.**

## 9. Next permitted execution unit

Hand §4's five questions to a human Optometry Domain Specialist (joined
by the Product Manager for Q2/Q3, the Security Reviewer for Q4, and
conditionally a Legal/Regulatory Reviewer if Q5 surfaces a real
requirement). No engineering action starts CP-019, CP-020, or CP-022
until §8's nine criteria are met.

## 10. Governance consistency

Re-verified live, this operation (§3): CP-020 remains `BLOCKED` on
CP-019; CP-022 remains transitively `BLOCKED` via CP-020; CP-017 remains
`IMPLEMENTED / VALIDATION-BLOCKED`, not merged; CP-016, CP-018, CP-021
remain `VALIDATED` and merged. No new CP or phase was introduced. No
second roadmap exists (`grep -c '"id": "CP-019"' roadmap.json` → 1, no
duplicate).

**Not rewritten** (out of this gate's scope, unrelated to CP-019's own
status): `docs/product/canonical-roadmap.md`'s summary table still shows
stale pre-merge statuses for five unrelated phases (CP-012/013/015/016/017
— contradicted by `roadmap.json`/`PROJECT_STATUS.md`/git). This was
first reported in `docs/product/phase-017-validation-audit.md` and again
in this file's prior revision; it does not touch CP-019's own row
("BLOCKED (needs domain-expert review)" — accurate) and correcting five
unrelated phases' historical status is not required for CP-019
consistency, so it is left untouched here, consistent with this
operation's own instruction not to "fix" unrelated stale documentation
unless strictly required.
