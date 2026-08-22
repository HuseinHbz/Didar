# CP-019 Domain Review

**This is a domain-decision gate, not a new canonical phase and not
feature implementation.** No new CP, phase, roadmap, or rename. No
Customer or Prescription domain code is authorized by this document.
Source: `docs/roadmap/master-roadmap-v2.md`, `## Track: Customer domain`,
`### P019 — Customer Domain & Prescription` — renumbered `CP-019` by
`canonical-roadmap.md` (content unchanged, only the ID prefix changes).

## Status: **NO IMPLEMENTATION AUTHORIZED**

CP-019 remains `BLOCKED`. This document records what a domain expert
must decide — it does not decide it, and it does not mark CP-019
`IMPLEMENTED` or `VALIDATED`. Nothing in `packages/database/prisma/schema.prisma`,
`services/api/src/modules/`, or `packages/validation/src/prescription.ts`
is created or changed by this operation.

## Canonical CP-019 mission

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

## Current blocker

`packages/validation/src/prescription.ts:12-15` (unchanged by this
operation, quoted verbatim):

> `TODO(optometry-domain-expert): the numeric bounds and step below are
reasonable industry defaults, not a clinically reviewed spec. Confirm
before this ships in a real order flow — see docs/product/blueprint.md
§21 and §121 (Optometry Domain Specialist role).`

This is the single named, canonical blocker. It is a human decision, not
a missing technical dependency (see "Repository evidence" below).

## Repository evidence

**Git** (re-verified live this operation, not assumed from a prior
report):

| Check                                                                                                                     | Result                                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Current branch                                                                                                            | `develop`                                  |
| `develop` HEAD (local == origin, tree clean)                                                                              | `2d0309a906035e4ff24aa6c33eaa09f731ec3abf` |
| `git merge-base --is-ancestor origin/16-feature-platform-reliability origin/develop`                                      | `true` — **CP-016 MERGED**                 |
| `git merge-base --is-ancestor origin/18-feature-admin-panel-mvp origin/develop`                                           | `true` — **CP-018 MERGED**                 |
| `git merge-base --is-ancestor origin/21-feature-procurement origin/develop`                                               | `true` — **CP-021 MERGED**                 |
| `git merge-base --is-ancestor origin/17-feature-real-notification-delivery origin/develop`                                | `false` — **CP-017 NOT merged**            |
| Any CP-019 branch, local or remote (`git branch -a` / `git ls-remote origin`, grepped for `19-feature`/`customer-domain`) | **none exists**                            |

CP-019's two canonical dependencies (`roadmap.json`: `["CP-015","CP-016"]`)
are both `VALIDATED` and merged. **The blocker is exclusively the
domain-expert-review gate — no unmet technical dependency exists.**

**Documentation** (`roadmap.json`, `canonical-roadmap.md`,
`phase-dependency-graph.md`, `gap-priority-matrix.md`,
`requirements-matrix.md`, `project-progress.md`, `PROJECT_STATUS.md`) —
all agree CP-019 is `BLOCKED` pending domain-expert review, `0%`
implemented, no branch. No document claims otherwise. (One stale,
unrelated finding — `canonical-roadmap.md`'s summary table for CP-012/013/015/016/017
— is carried in "Governance consistency" below; it does not touch
CP-019's own row or status.)

## Current implementation evidence

Verified through source, not inferred from a similarly-named table:

| Item                                                           | Exists?                                                           | Evidence                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Prescription` Prisma model                                    | **No**                                                            | `grep -n "^model Prescription" packages/database/prisma/schema.prisma` — zero matches                                                                                                                                                    |
| Dedicated `customer` module in `services/api/src/modules/`     | **No**                                                            | `ls services/api/src/modules/` → `cart-checkout, catalog, health, identity, inventory, order, payment, promotion, return`                                                                                                                |
| `Customer` / `CustomerAddress` schema                          | Yes, schema only, no application code beyond one read-only lookup | `schema.prisma:377`/`:399`; only caller is `cart-checkout`'s read-only `PrismaCustomerLookupRepository` (ownership checks, not a profile API)                                                                                            |
| `FamilyMember` / `LoyaltyAccount` / `WalletAccount` schema     | Yes, schema only, zero application code                           | `schema.prisma:424`/`:473`/`:504`; zero hits for any of the three across `services/api/src`                                                                                                                                              |
| Prescription value-bounds validator                            | Yes, explicitly unreviewed                                        | `packages/validation/src/prescription.ts` — see "Current blocker" above (quoted verbatim, unchanged)                                                                                                                                     |
| Prescription _reference_ validator                             | Yes, explicitly incomplete by design                              | `services/api/src/modules/cart-checkout/domain/services/prescription-reference-validator.ts` — returns `'unverified'`, never a fabricated `'valid'`, by its own documented design (no `Prescription` entity exists to check against yet) |
| Any ADR for CP-019                                             | **No**                                                            | `ls docs/adr/` — no CP-019/customer/prescription entry                                                                                                                                                                                   |
| Any recorded domain-expert sign-off anywhere in the repository | **No**                                                            | Repo-wide grep for the TODO's own marker and "domain-expert"/"optometrist review" hits only the same unresolved TODO and documents quoting it                                                                                            |

## Five decision questions

Per this operation's own instruction, none of these is answered here —
each states only what the repository already contains, and asks the
question the repository cannot answer on its own.

### 1. Prescription numeric bounds

Which numeric ranges/constraints require optometry-domain approval?
**Current repository-defined bounds** (`packages/validation/src/prescription.ts`,
quoted verbatim, **not changed by this operation**):

- SPH (sphere): ±20.00 diopters, 0.25 steps
- CYL (cylinder): ±10.00 diopters, 0.25 steps
- AXIS: 0–180°, integer, required whenever CYL is provided
- ADD (addition/bifocal): 0.00 to +4.00 diopters, 0.25 steps
- PD (pupillary distance): 20–80mm (code comment: binocular 50–75mm,
  monocular 25–40mm per eye)

**HUMAN DECISION REQUIRED** — whether each bound above is clinically
correct as-is, or needs adjustment, is not decidable from repository
evidence. Not guessed here.

### 2. Review scope

What must be decided between:

- **A. Validation/bounds review only** — a one-time technical sign-off
  confirming the five numeric bounds above are correct; no per-instance
  workflow. This is the literal scope of P019's own deliverable #3
  ("Real optometry-domain review of `packages/validation/src/prescription.ts`'s
  numeric bounds").
- **B. A full Optometrist Review workflow** — a per-prescription
  approval state machine (`Prescription → Optometrist Review →
Approved/Rejected/Need More Info`), as separately described in
  `docs/product/blueprint.md` §21 (lines 4396–4444).
- **C. Another explicitly documented scope** — none is currently
  documented anywhere in the repository beyond A and B above.

**HUMAN DECISION REQUIRED** — P019's own deliverable text names only A;
blueprint §21 (a separate, earlier document P019 itself cites) describes
B. The repository does not resolve which one CP-019 must build. Not
guessed here.

### 3. Prescription data model

Compare only the models already present in repository evidence:

- **A. Flat/simple `Prescription` entity** — one row per prescription,
  matching P019's own deliverable text ("Prescription domain entity +
  migration").
- **B. Versioned/multi-table blueprint model** — `docs/product/blueprint.md`
  §20 (lines 4391–4400) lists five tables: `prescriptions`,
  `prescription_versions`, `prescription_items`, `prescription_images`,
  `prescription_verifications`.

No third architecture is proposed — none exists in repository evidence.

**HUMAN DECISION REQUIRED** — P019's deliverable text implies A;
blueprint §20 describes B. Not guessed here.

### 4. Encryption at rest

Does the repository's existing requirement text **explicitly require**
encryption for Prescription data, or does it require only a security
**evaluation**?

Verbatim, P019's own `security_requirements` block: "Prescription data
is the most sensitive personal data this platform will hold — ownership
checks reviewed with the same rigor as financial data, **encryption-at-rest
evaluated explicitly**."

The text says "evaluated," not "required" or "mandatory." Whether that
evaluation's outcome must be "yes, encrypt" or may legitimately be "no,
defer" is not stated anywhere in the repository.

**HUMAN DECISION REQUIRED** — not guessed here. (Note, not a decision:
`services/api`'s identity module already has a reusable
`ENCRYPTION_KEY`-based encryption utility, so if the outcome is
"encrypt," the mechanism already exists — that is a technical fact, not
part of the decision itself.)

### 5. Iran-specific regulatory requirements

What requires explicit confirmation from a qualified domain/legal
reviewer?

The repository states only the general principle, `docs/product/blueprint.md:4435`
(verbatim): "سیستم نباید تشخیص پزشکی اختراع کند" ("the system must not
invent medical diagnosis"). **No specific Iran-market regulation,
medical-device classification, or optometry-licensing law is cited
anywhere in the repository.**

**HUMAN DECISION REQUIRED** — whether a specific regulatory or legal
constraint applies to collecting/storing optical prescription data is
not established by repository evidence and is not invented here.

## Decisions required (summary)

| #   | Decision                                        | Resolved by repository evidence? | Status                      |
| --- | ----------------------------------------------- | -------------------------------- | --------------------------- |
| 1   | Numeric bounds correctness                      | No                               | **HUMAN DECISION REQUIRED** |
| 2   | Review scope (A/B/C)                            | No                               | **HUMAN DECISION REQUIRED** |
| 3   | Data model shape (A/B)                          | No                               | **HUMAN DECISION REQUIRED** |
| 4   | Encryption-at-rest: mandatory vs. evaluate-only | No                               | **HUMAN DECISION REQUIRED** |
| 5   | Iran-specific regulatory constraint             | No                               | **HUMAN DECISION REQUIRED** |

All five remain **awaiting human review**. None is resolved by this or
any prior operation.

## Required reviewers

Determined from repository evidence only — no named individuals are
fabricated, only roles the repository itself already identifies:

| Decision(s) | Reviewer role                                                                                                                       | Basis                                                                                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 2, 5     | **Optometry Domain Specialist**                                                                                                     | `docs/product/blueprint.md` §122's own named role list, line 3238; the TODO's own marker (`optometry-domain-expert`)                                                                                                                                       |
| 2, 3        | **Product Manager**                                                                                                                 | Both are scope-size decisions (workflow breadth, schema breadth), not purely clinical ones                                                                                                                                                                 |
| 4           | **Security Reviewer**                                                                                                               | P019's own `security_requirements` block names encryption-at-rest evaluation explicitly                                                                                                                                                                    |
| 5           | **Legal/Regulatory Reviewer** — _only if_ the Optometry Domain Specialist's answer to Q5 identifies an actual applicable regulation | Not asserted as needed outright — the repository contains no evidence a specific regulation applies; this role is conditional on Q5's own outcome, per this operation's own instruction not to fabricate a review requirement the evidence doesn't support |

No named person is assigned to any role — none is identified anywhere in
the repository.

## Criteria required to unblock CP-019

CP-019 may move from `BLOCKED` to implementation-ready only when **all**
of the following exist, per its own acceptance criteria and
`phase-governance.md`'s Definition of Ready:

1. All five decisions above are recorded with an actual answer (not a
   default, not an engineering guess).
2. A dated ADR for CP-019 exists, naming the domain expert's sign-off —
   per P019's own acceptance criterion #2 ("this phase does not ship
   without it").
3. `packages/validation/src/prescription.ts`'s bounds are updated to
   match the confirmed answer to Decision 1 (or explicitly confirmed
   unchanged, if the expert agrees the current defaults are correct).
4. A `19-feature-customer-domain-prescription` branch is cut per
   `phase-governance.md`'s Definition of Ready item 5 — only after 1–3
   above, not before.

None of these four exist yet. This document is Decision-package
delivery only — it does not satisfy any of them.

## Governance consistency

Re-verified this operation, live:

- **CP-020** remains `NOT_STARTED`, blocked on CP-019 (`roadmap.json`
  dependency: `["CP-016","CP-018","CP-019"]` — CP-016/CP-018 satisfied,
  CP-019 not).
- **CP-022** remains `NOT_STARTED`, blocked transitively via CP-020
  (`roadmap.json` dependency: `["CP-018","CP-020"]`).
- **CP-017** remains `IMPLEMENTED / VALIDATION-BLOCKED`, not merged —
  see `docs/product/phase-017-validation-audit.md`; re-confirmed live
  via `git merge-base --is-ancestor` above.
- **CP-016, CP-018, CP-021** remain `VALIDATED` and merged — re-confirmed
  live via `git merge-base --is-ancestor` above (not assumed from any
  prior report).
- No new CP or phase was introduced by this or any prior operation. No
  second roadmap exists (`docs/product/roadmap.json` remains the one
  machine-readable source; `grep -c '"id": "CP-019"' roadmap.json` → 1,
  no duplicate).

**Stale, unrelated finding — reported, not silently rewritten:**
`docs/product/canonical-roadmap.md`'s summary table still shows CP-012
"BLOCKED (not merged to develop)", CP-013 "BLOCKED (not merged to
develop)", CP-015 "NOT_STARTED", CP-016 "NOT_STARTED", CP-017
"NOT_STARTED" — all contradicted by `roadmap.json`/`PROJECT_STATUS.md`/
git (CP-012/013/015/016 are `VALIDATED` and merged; CP-017 is
`IMPLEMENTED / VALIDATION-BLOCKED`). Root cause: `git log -- docs/product/canonical-roadmap.md`
shows only CP-018's and CP-021's own branches ever edited this file,
each touching only its own row. **This does not touch CP-019's own row**
("BLOCKED (needs domain-expert review)" — accurate), and this
operation's own dependency verification used `roadmap.json` + live git,
not this table. Per `phase-governance.md`'s own ownership rule
("whichever phase most recently touched them" keeps these in sync),
correcting five _unrelated_ phases' historical status here would be
out-of-scope, unrelated-history rewriting — explicitly not this
operation's job, left for whichever phase next legitimately touches
that file.

## Exact next action

Hand the five questions above to a human Optometry Domain Specialist
(joined by the Product Manager for Q2/Q3, the Security Reviewer for Q4,
and conditionally a Legal/Regulatory Reviewer only if Q5's answer
surfaces an actual applicable regulation). No engineering action starts
CP-019, CP-020, or CP-022 until the four "Criteria required to unblock"
above are met.
