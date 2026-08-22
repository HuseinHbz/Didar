# CP-019 Domain Review

**This is a governance/domain-validation operation, not a new canonical
phase, and not feature implementation.** No new CP, phase, roadmap, or
rename. It reconstructs CP-019's canonical definition, audits the
repository against it, and produces the decision package a real domain
expert needs — the deliverable this operation exists to produce.

## 1. Canonical Definition

Source: `docs/roadmap/master-roadmap-v2.md`, `## Track: Customer domain`,
`### P019 — Customer Domain & Prescription` (lines 275–323), renumbered
`CP-019` by `canonical-roadmap.md` (content unchanged, only the ID
prefix changes, per that document's own stated rule).

- **Canonical name:** CP-019 — Customer Domain & Prescription
- **Mission (verbatim):** "Build a real Customer domain beyond auth —
  profile, address management (extending the existing thin lookup), and
  a real Prescription entity — gated on the existing TODO's optometry-
  domain review, not built ahead of it."
- **Business value (verbatim):** "Closes the single largest gap between
  'backend commerce platform' and 'eyewear commerce platform.'
  Prescription handling is the category differentiator this platform is
  named for."
- **Deliverables:**
  1. Prescription domain entity + migration (does not exist today)
  2. Prescription CRUD scoped to the owning customer (same ownership-
     check pattern as cart-checkout/order)
  3. Real optometry-domain review of `packages/validation/src/prescription.ts`'s
     numeric bounds — **BLOCKING**, must happen before the Prescription
     entity ships, not after
  4. Family member linkage (using the existing `customer.FamilyMember`
     table — first real code to touch it)
  5. Loyalty/Wallet — **explicitly OUT of scope** for this phase (a
     separate, smaller follow-on); the definition itself says "do not
     scope-creep"
- **Acceptance criteria:**
  1. A customer can attach a reviewed, valid prescription to an order line
  2. The domain-expert review is a named, dated sign-off in the ADR for
     this phase — this phase does not ship without it
- **Dependencies (canonical):** CP-015, CP-016 — both **VALIDATED and
  merged** (re-verified independently in §2 below; not assumed from
  documentation).
- **Dependents:** CP-020 (Storefront MVP), CP-024 (CRM beyond coupons) —
  both list CP-019 as a hard dependency in `roadmap.json`.
- **Reason for BLOCKED status:** a real, named, non-technical blocker —
  the numeric bounds in `packages/validation/src/prescription.ts` are
  "reasonable industry defaults, not a clinically reviewed spec"
  (verbatim from that file's own header comment) and must be confirmed
  by an optometry domain expert before the Prescription entity ships.
  This is declared `risk: HIGH` in P019's own definition, with the
  explicit instruction: "do not let engineering timeline pressure ship
  without it."
- **Expected domain expertise:** an optometrist / optical-dispensing
  professional, per blueprint §122's own named role "Optometry Domain
  Specialist" (`docs/product/blueprint.md` line 3238).
- **Business decisions required:** see §5.
- **Technical decisions required:** see §5 (the same table covers both —
  CP-019's own decisions are not cleanly separable into pure-business
  vs. pure-technical; each has a technical consequence attached).
- **Evidence currently available:** the unreviewed bounds validator
  itself, the honestly-incomplete prescription-reference validator, the
  existing `Customer`/`CustomerAddress`/`FamilyMember` schema (unused by
  any application code), blueprint §20/§21's original design intent —
  all cited with file/line evidence in §3.
- **Evidence currently missing:** any actual optometry sign-off, any ADR
  for this phase (none exists — confirmed, `docs/adr/` has no CP-019/
  customer/prescription entry), any recorded answer to the domain
  questions in §5.

**No reinterpretation, no scope expansion.** Multiple documents were
checked for disagreement over CP-019's definition itself
(`master-roadmap-v2.md`, `canonical-roadmap.md`, `roadmap.json`,
`gap-priority-matrix.md`, `requirements-matrix.md`, `project-progress.md`)
— all agree on scope, dependencies, and blocked status. The one
disagreement found is about _unrelated_ phases' status in a summary
table, not CP-019's own definition (see §8) — it does not trigger a
Phase 8 stop.

## 2. Git Evidence

Git is authoritative; documentation state was not trusted blindly.

```
$ git branch -a | grep -i "19-feature\|customer"
(no output)
$ git ls-remote origin | grep -i "19-feature\|customer"
(no output)
```

**No CP-019 branch exists anywhere — local or remote.** Zero
implementation commits. This matches `roadmap.json`'s own `CP-019` entry
(`gitBranch: null`, `latestCommit: null`, `completionPercent: 0`) exactly
— no contradiction.

Re-verified this operation, independently of any prior claim (per the
explicit instruction not to trust a summary blindly), for the phases
CP-019 actually depends on and the one flagged for re-verification:

```
$ git merge-base --is-ancestor origin/16-feature-platform-reliability origin/develop && echo MERGED
MERGED
$ git merge-base --is-ancestor origin/18-feature-admin-panel-mvp origin/develop && echo MERGED
MERGED
$ git merge-base --is-ancestor origin/21-feature-procurement origin/develop && echo MERGED
MERGED
$ git log --oneline develop | grep procurement | head -1
e5d0034 Merge branch '21-feature-procurement' into develop
$ git merge-base --is-ancestor origin/17-feature-real-notification-delivery origin/develop && echo MERGED || echo "NOT merged"
NOT merged
```

- `develop` HEAD (local == origin, working tree clean): `ca4480b829594ebd8ad628df0942c9382f62f2ef`
- CP-021 status **re-verified directly from git, as explicitly
  required**: genuinely merged (`e5d0034` is in `develop`'s own history)
  — the prior report was accurate, not merely repeated.
- CP-016/CP-018 also re-confirmed merged. CP-017 re-confirmed **not**
  merged, consistent with its own `IMPLEMENTED / VALIDATION-BLOCKED`
  status (`docs/product/phase-017-validation-audit.md`).

**Conclusion: CP-019's own two dependencies (CP-015, CP-016) are both
VALIDATED and merged into `develop`.** The Definition-of-Ready
dependency gate (`phase-governance.md` item 3: "every phase this one
depends on is itself at least `IMPLEMENTED` status") is **satisfied**.
CP-019 is blocked by the domain-expert-review gate alone, not by any
unmet technical dependency.

## 3. Current Implementation Evidence

Verified through source code, schema, and a live grep of application
wiring — not inferred from a similarly-named table existing.

| Item                                                                                                              | Exists?                                     | Evidence                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Prescription` Prisma model                                                                                       | **No**                                      | `grep -n "^model Prescription" packages/database/prisma/schema.prisma` — zero matches                                                                                                                                                                                                                                                         |
| `Customer` / `CustomerAddress` models                                                                             | Yes, schema only                            | `schema.prisma:377` (`Customer`), `:399` (`CustomerAddress`) — both in the `customer` schema                                                                                                                                                                                                                                                  |
| `FamilyMember` / `LoyaltyAccount` / `WalletAccount` models                                                        | Yes, schema only                            | `schema.prisma:424` (`FamilyMember`), `:473`/`:504` (Loyalty/Wallet)                                                                                                                                                                                                                                                                          |
| Any application code (domain/application/API) touching `Customer`/`FamilyMember`/`LoyaltyAccount`/`WalletAccount` | **One read-only exception; otherwise none** | `grep -rln "prisma\.customer\." services/api/src` → exactly one file: `cart-checkout/infrastructure/repositories/prisma-customer-lookup.repository.ts` (a read-only ownership lookup, not a customer-domain module). `FamilyMember`/`LoyaltyAccount`/`WalletAccount`: zero application-code hits anywhere.                                    |
| A dedicated `customer` module in `services/api/src/modules/`                                                      | **No**                                      | `ls services/api/src/modules/` → `cart-checkout, catalog, health, identity, inventory, order, payment, promotion, return` — no `customer` directory                                                                                                                                                                                           |
| Prescription value-bounds validator                                                                               | Yes, explicitly unreviewed                  | `packages/validation/src/prescription.ts:12-15` — its own header: `TODO(optometry-domain-expert): the numeric bounds and step below are reasonable industry defaults, not a clinically reviewed spec.`                                                                                                                                        |
| Prescription _reference_ validator (cart-checkout)                                                                | Yes, explicitly incomplete by design        | `services/api/src/modules/cart-checkout/domain/services/prescription-reference-validator.ts` — its own doc comment: "no `Prescription` entity exists anywhere in this schema yet, so there is nothing to check existence/ownership _against_." Returns `'valid_shape' \| 'invalid_shape' \| 'unverified'` — **never** a fabricated `'valid'`. |
| `CartItemOption` forward-compatible prescription reference slot                                                   | Yes                                         | `schema.prisma:1585-1587` — `optionKey` documented as holding "a prescription/customization _reference_... never sensitive prescription values themselves (ADR-007 decision 9)"                                                                                                                                                               |
| Any ADR for CP-019                                                                                                | **No**                                      | `ls docs/adr/` — no CP-019/customer/prescription-domain entry exists                                                                                                                                                                                                                                                                          |
| Any recorded domain-expert sign-off, anywhere in the repository                                                   | **No**                                      | Repo-wide grep for `optometry-domain-expert`/`domain-expert.*sign`/`optometrist.*review` hits only the same TODO comment and the docs that quote it — no sign-off record found                                                                                                                                                                |

## 4. Requirement Matrix

Every CP-019 canonical requirement, classified per this operation's own
enum (`IMPLEMENTED` / `PARTIAL` / `NOT_IMPLEMENTED` / `NOT_APPLICABLE` /
`BLOCKED_BY_EXTERNAL_DECISION` / `UNVERIFIABLE`):

| Requirement                                                                                  | Classification                   | Evidence                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prescription domain entity + migration                                                       | **NOT_IMPLEMENTED**              | No `Prescription` model in `schema.prisma`; no CP-019 branch/migration exists (§2, §3)                                                              |
| Prescription CRUD scoped to owning customer                                                  | **NOT_IMPLEMENTED**              | Depends on the entity above, which doesn't exist; no controller/use case exists                                                                     |
| Optometry-domain review of the numeric bounds                                                | **BLOCKED_BY_EXTERNAL_DECISION** | This _is_ the named blocker itself — a human decision, not code (§1, §5)                                                                            |
| Family member linkage (`FamilyMember` table, first real code)                                | **NOT_IMPLEMENTED**              | Model exists (schema only); zero application code touches it (§3)                                                                                   |
| Loyalty/Wallet (explicitly out of CP-019's own scope)                                        | **NOT_APPLICABLE**               | P019's own text: "explicitly OUT of scope for this phase... do not scope-creep" — correctly not built                                               |
| Acceptance: customer can attach a _reviewed, valid_ prescription to an order line            | **NOT_IMPLEMENTED**              | `PrescriptionReferenceValidator` can only return `'unverified'` today, by explicit design — never `'valid'`                                         |
| Acceptance: domain-expert review is a named, dated ADR sign-off                              | **NOT_IMPLEMENTED**              | No ADR exists for CP-019 (§3)                                                                                                                       |
| Customer profile/address management API (mission text, "extending the existing thin lookup") | **NOT_IMPLEMENTED**              | The "thin lookup" itself is real but read-only and ownership-check-only (`PrismaCustomerLookupRepository`); no profile/address CRUD endpoints exist |

No requirement was marked `IMPLEMENTED` merely because a similarly-named
table exists — every `NOT_IMPLEMENTED` finding above was verified by the
absence of any calling application code, not just schema presence.

## 5. Domain Decisions Required

Every question below traces to specific text in P019's own canonical
definition or to `blueprint.md` sections P019 itself cites (§20/§21) —
none is invented beyond what CP-019 actually supports.

| #   | Question                                                                                                                                                                                                                                                                                                              | Why it matters                                                                                                                                                                                                                                                                                          | Current system assumption                                                                                                                                                             | Evidence                                                                                                                                                                                                     | Decision required from                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 1   | Are the current numeric bounds correct? SPH ±20.00D (0.25 steps), CYL ±10.00D (0.25 steps), AXIS 0–180° (integer), ADD 0.00–+4.00D (0.25 steps), PD 20–80mm (binocular 50–75/monocular 25–40 per the code comment)                                                                                                    | This is P019's own named, blocking deliverable — the Prescription entity may not ship until these are confirmed                                                                                                                                                                                         | Values are "reasonable industry defaults," explicitly self-labeled as not clinically reviewed (`prescription.ts:12-15`)                                                               | `packages/validation/src/prescription.ts:21-46` (exact schema + comments)                                                                                                                                    | Optometry Domain Specialist                                                    |
| 2   | What does "domain-expert review... is a named, dated sign-off in the ADR" cover: only the numeric-bounds constants above, or also the per-prescription **Optometrist Review workflow** (`Prescription → Optometrist Review → Approved / Rejected / Need More Info`) blueprint §21 separately describes?               | P019's own deliverable list is silent on whether a review _workflow_ (a state machine, an approval role, an audit trail per prescription) is in scope, or whether "review" means a one-time technical sign-off on the validator's constants only. This materially changes CP-019's implementation size. | Not decided anywhere in the repository — no code assumes either answer                                                                                                                | `docs/product/blueprint.md:4396-4444` (§21, the Optometrist Review flow) vs. `master-roadmap-v2.md:275-323` (P019's own narrower deliverable text, which never mentions a per-instance review state machine) | Product Manager + Optometry Domain Specialist jointly                          |
| 3   | Does CP-019 build the full 5-table prescription domain blueprint §20 describes (`prescriptions`, `prescription_versions`, `prescription_items`, `prescription_images`, `prescription_verifications`), or the flat single-entity model P019's own deliverable text implies ("Prescription domain entity + migration")? | Directly determines the migration's shape and this phase's size — versioning and image-attachment support are materially larger than a flat entity                                                                                                                                                      | Nothing built yet either way; `CartItemOption.optionKey` (the one existing forward-compatible slot) is entity-agnostic — it works with either shape                                   | `docs/product/blueprint.md:4391-4400` (§20's 5-table list) vs. `master-roadmap-v2.md:288-289` (P019's own single-line deliverable)                                                                           | Product Manager + Lead Software Architect                                      |
| 4   | Does "encryption-at-rest evaluated explicitly" (P019's own security requirement) mean field-level encryption of prescription values is **mandatory before ship**, or that a documented evaluate-and-decide pass is sufficient (with a possible "no, defer" outcome)?                                                  | Prescription data is named in P019's own text as "the most sensitive personal data this platform will hold" — the encryption bar directly affects both schema design and the Prescription CRUD's implementation cost                                                                                    | `packages/database` already has an `ENCRYPTION_KEY`-based encryption utility used elsewhere in the codebase (identity module) — reusable, but not yet decided whether it applies here | `master-roadmap-v2.md:303-306` (P019's own `security_requirements` block)                                                                                                                                    | Security Reviewer + Product Manager                                            |
| 5   | Is there a specific Iran-market regulatory or medical-device constraint on collecting/storing optical prescription data that this phase must satisfy (beyond the blueprint's own general "must not invent medical diagnosis" principle)?                                                                              | If a specific regulatory citation applies, it changes retention, consent, and access-control requirements; if none applies, this can be explicitly closed out rather than left as an open unknown                                                                                                       | No specific regulation is cited anywhere in the repository — blueprint §21 states only the general principle, not a named law/standard                                                | `docs/product/blueprint.md:4435` (`سیستم نباید تشخیص پزشکی اختراع کند` — "the system must not invent medical diagnosis")                                                                                     | Optometry Domain Specialist + Legal/Compliance (if one exists on this project) |

Each question above includes, per this operation's own required format:
(1) the question, (2) why it matters, (3) current implementation
behavior, (4) evidence, (5) who must decide. **No business question was
answered on the domain expert's behalf** — the repository contains no
authoritative evidence that would justify doing so for any of the five.

## 6. Blocking Issues

- **The single named blocker**: optometry-domain review of the
  prescription bounds validator, unresolved (§1, §5 Q1).
- **A secondary, discovered ambiguity** (§5 Q2/Q3): P019's own text and
  blueprint §20/§21 do not fully agree on scope size (flat entity vs.
  5-table versioned domain; bounds-only sign-off vs. a full review
  workflow). This is not a new blocker beyond the named one — it is a
  clarification the same domain-expert-review pass should resolve, so it
  is folded into the decision package (§5) rather than treated as a
  second, independent gate.
- No technical/dependency blocker exists — CP-015 and CP-016 are both
  satisfied (§2).

## 7. Dependency Impact

| CP                                     | Dependency on CP-019                                  | Impact                                                                                                   | Can proceed?                                     |
| -------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| CP-020                                 | Hard (`roadmap.json`: `["CP-016","CP-018","CP-019"]`) | Storefront MVP cannot start — CP-019 is a named, unmet prerequisite alongside two already-satisfied ones | **No**                                           |
| CP-022                                 | Indirect, via CP-020 (`["CP-018","CP-020"]`)          | Blocked transitively — CP-018 alone is satisfied, but CP-020 is not, so CP-022 cannot start either       | **No**                                           |
| CP-024                                 | Hard (`roadmap.json`: `["CP-019","CP-020"]`)          | Double-blocked on both CP-019 directly and CP-020 transitively                                           | **No**                                           |
| Every other CP (CP-023, CP-025–CP-029) | None                                                  | No dependency relationship to CP-019 in `roadmap.json`                                                   | Independent of this gate (own status unaffected) |

No status of CP-020/CP-022/CP-024 or any other CP is changed by this
operation — this table reports impact, it does not decide it. No
implementation path around the blocked dependency was invented for any
of them.

## 8. Governance Contradictions

Two contradictions were found. **Neither blocks CP-019's own review
readiness** — both are reported, neither was silently fixed.

1. **`docs/product/canonical-roadmap.md`'s summary table is stale for
   five unrelated phases.** It still shows: CP-012 "BLOCKED (not merged
   to develop)", CP-013 "BLOCKED (not merged to develop)", CP-015
   "NOT_STARTED", CP-016 "NOT_STARTED", CP-017 "NOT_STARTED" — all
   contradicted by `roadmap.json`, `PROJECT_STATUS.md`, and git (CP-012/013/015/016
   are VALIDATED and merged; CP-017 is `IMPLEMENTED / VALIDATION-BLOCKED`,
   confirmed in `docs/product/phase-017-validation-audit.md`). Root
   cause: `git log -- docs/product/canonical-roadmap.md` shows only
   CP-018's and CP-021's own branches ever edited this file — each
   updated only its own single row, never the others, and no later
   integration operation touched this particular file (unlike
   `PROJECT_STATUS.md`/`project-progress.md`/`roadmap.json`, which every
   integration operation this session has kept in sync by hand). **This
   does not affect CP-019** — CP-019's own row in the same table
   ("BLOCKED (needs domain-expert review)") is accurate, and CP-019's
   actual dependency check in this operation used `roadmap.json` + live
   git (§2), not this stale table. Per `phase-governance.md`'s own rule
   ("whichever phase most recently touched them" owns keeping these in
   sync), this is left for a future phase's own Definition of Done to
   correct — fixing an unrelated five-phase documentation table is
   outside this domain-validation operation's scope, and this operation
   makes no code or feature changes per its own Phase 5 no-code rule.
2. **`roadmap.json`'s own per-phase object for CP-017 still reads
   `NOT_STARTED` / `gitBranch: null`.** This is a known, already
   self-documented pattern (the tool's own `nextPhase` narrative field
   explicitly says so: "CP-017's own status is unchanged by this file —
   its real implementation lives on the sibling branch... not yet
   reflected here") — the per-phase JSON object only updates when a
   branch is actually merged, and CP-017 is deliberately not merged
   (§2). Not a new finding; re-confirmed and cross-referenced here per
   this operation's own Phase 7 instruction to detect (not silently
   fix) exactly this class of issue.

No orphan CPs, no duplicate CP-019 definition (`grep -c '"id": "CP-019"'
roadmap.json` → 1), no missing P0 owner, no circular dependency —
confirmed via `pnpm roadmap:audit`'s own structural check: "✓ No
structural problems found."

## 9. Decision

**A. DOMAIN REVIEW READY.**

All Definition-of-Ready dependency gates CP-019 itself needs are
satisfied (CP-015, CP-016 both VALIDATED and merged, re-verified live
via git). The domain-expert-review package (§5) is fully constructible
from existing repository evidence — five concrete, evidence-backed
questions, none invented beyond what CP-019's own canonical definition
and the blueprint sections it cites actually support. What remains is
not missing engineering work or an unmet technical prerequisite — it is
a human decision that has not yet been made. The package in §5 is the
exact artifact to hand to the Optometry Domain Specialist (and, for
questions 2–4, jointly with the Product Manager / Security Reviewer).

This is **not** a decision that CP-019 may now begin implementation —
implementation remains gated on the domain expert's actual answers,
per P019's own explicit rule ("this phase does not ship without it").

## 10. Evidence

All evidence is inline above with file paths and line numbers; no
speculative percentages are used anywhere in this document (CP-019's
`completionPercent` remains `0` in `roadmap.json`, unchanged by this
operation — it does not lie about progress that doesn't exist).
Summary of primary sources consulted: `docs/roadmap/master-roadmap-v2.md`
(P019 canonical definition), `docs/product/blueprint.md` §20/§21/§122
(original domain design intent, Optometry Domain Specialist role),
`packages/database/prisma/schema.prisma` (Customer/CustomerAddress/
FamilyMember/Loyalty/Wallet/CartItemOption models), `packages/validation/src/prescription.ts`
(bounds validator), `services/api/src/modules/cart-checkout/domain/services/prescription-reference-validator.ts`
(reference validator), `docs/product/roadmap.json`/`canonical-roadmap.md`/
`phase-dependency-graph.md`/`gap-priority-matrix.md`/`requirements-matrix.md`/
`project-progress.md`/`PROJECT_STATUS.md`/`phase-governance.md`/
`phase-audit-checklist.md` (governance cross-check), live `git` commands
(branch/merge-base/ancestry, §2).

## 11. Exact Next Action

**Hand the §5 decision package to a human Optometry Domain Specialist**
(with the Product Manager and Security Reviewer looped in for questions
2–4, which are joint product/technical scope calls, not purely clinical
ones). No engineering action starts CP-019 until answers are recorded —
per this operation's own explicit rule, do **not** start CP-020, do
**not** start any implementation, do **not** create a new CP or phase.
Once answered, the recommended immediate next steps (not performed by
this operation) are: (a) write CP-019's ADR recording the domain
expert's dated sign-off, per its own acceptance criterion #2, and (b)
only then create the `19-feature-customer-domain-prescription` branch
per `phase-governance.md`'s Definition of Ready item 5.
