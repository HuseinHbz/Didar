# Phase 030 Audit (CP-030 — Remediation Roadmap & Review Correction)

Required audit output for CP-030, matching the shape
[`phase-021-audit.md`](phase-021-audit.md) established.

## Mission

Turn the cross-functional review of this repository (finance, optical / lens
specialism, marketing, project / product management) into phased, owned,
verifiable remediation work inside the repository's own governance — and
correct the review where it was wrong. Documentation and governance only; no
application code changes in this phase.

## Canonical source

[`remediation-roadmap.md`](remediation-roadmap.md) (findings register, phase map,
sequencing, open decisions) and [`ADR-030`](../adr/ADR-030-remediation-roadmap.md)
(decisions). Phase definitions live in [`roadmap.json`](roadmap.json) (CP-030 –
CP-039).

## Dependency evidence

CP-030's declared dependencies are CP-014 and CP-015, both `VALIDATED` in
`roadmap.json` and present on `develop`. Branch point: `30-feature-remediation-roadmap`
was cut from `origin/develop` at `6a35e9e`.

## Branch

`30-feature-remediation-roadmap`

## Commits

See `git log origin/develop..30-feature-remediation-roadmap`. The phase lands as one
documentation commit, one formatting-only commit (the two pre-existing prettier
violations below), and a follow-up that records the phase's own final SHA in
`roadmap.json` (the precedent CP-021 set).

## Implementation summary

- **New:** `docs/product/remediation-roadmap.md`, `docs/adr/ADR-030-remediation-roadmap.md`,
  this audit.
- **`roadmap.json`:** +10 phases (CP-030 – CP-039), +13 requirements, +16 gaps
  (P0-3 – P0-8, P1-10 – P1-15, P2-13 – P2-16); `nextPhase` rewritten (it still
  recommended CP-021, which is `VALIDATED`); `aggregate` 19 / 0 / 1 / 20 / 40;
  additive `unmergedBranch` / `unmergedLatestCommit` / `unmergedNote` fields on
  CP-017 / 019 / 028 / 029 and `implementedOnBranchNote` on gaps P1-2, P1-4, P1-5,
  P2-6, P2-7 (ADR-030 decision 7 — status and `gitBranch` deliberately untouched).
- **Re-synchronised:** `canonical-roadmap.md` (status drift fixed for CP-012 –
  CP-016, new rows and capability owners), `gap-priority-matrix.md`,
  `project-progress.md`, `phase-dependency-graph.md`, `requirements-matrix.md`,
  `next-phase-decision.md`, `PROJECT_STATUS.md`.
- **Hygiene (separate commit):** `docs/api/payment.md` and
  `docs/security/payment-security.md` already failed `prettier --check` on
  `develop`; one table cell in `payment.md` also contained an unescaped `|` inside a
  code span (`Status=OK|NOK`), which GFM renders as an extra column. Escaped and
  reformatted; no wording changed.

## Verification

Every command below was run for this phase; none is asserted from memory.

| Check                                                                                                                | Result                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/roadmap-audit.mjs --skip-db`                                                                           | `✓ No structural problems found` — 40 phases, no orphan requirement, no P0 gap without owner, no circular dependency, all governance documents present. Aggregate as recorded: 19 completed / 0 partial / 1 in progress / 20 planned / 40 total |
| `pnpm validate:structure`                                                                                            | `✓ Repository structure validation passed`                                                                                                                                                                                                      |
| `pnpm exec prettier --check .`                                                                                       | Clean for every tracked file. The only warnings are the three generated `apps/*/next-env.d.ts` files, which exist in this working tree only because a local typecheck ran; they are git-ignored and absent in CI                                |
| Cross-document consistency script (phase map ↔ `roadmap.json`; gap, requirement and CP tokens; aggregate arithmetic) | 10 phase-map rows, 24 distinct gap IDs referenced, 13 new requirements, aggregate sums to 40 — **all consistent**                                                                                                                               |

Claims in the findings register were re-derived from `origin/develop`, not copied
from the earlier review:

| Claim                                           | How verified                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main` is 134 commits behind `develop`          | `git rev-list --left-right --count origin/develop...origin/main` → `134 0`; `git ls-tree -d --name-only origin/main services/api/src/modules/` → only `cart-checkout catalog health identity inventory payment`                                                                                                     |
| Branch 17 / 19 / 28 / 29 divergence             | Same command → `25 10`, `0 8`, `0 3`, `0 3` (left = only on `develop`, right = only on the branch); commit subjects read with `git log origin/develop..origin/<branch>`                                                                                                                                             |
| P0-3 TTL mismatch                               | `DEFAULT_CHECKOUT_TTL_MINUTES = 20` (`checkout.service.ts:36`), `DEFAULT_INTENT_TTL_MINUTES = 30` (`payment-intent.service.ts:31`)                                                                                                                                                                                  |
| P0-4 `markConverted` no-op and sweep blind spot | `checkout.service.ts` `markConverted()` returns the session unchanged when `canTransition` is false; `CheckoutStateMachine.GRAPH` has `EXPIRED: []`; `order-conversion.processor.ts` uses only `listConvertedSince` and `listStuckPendingConversion`                                                                |
| P0-5 swallowed reservation conversion           | `order-conversion.service.ts` lines 177–193: `if (reservation?.status === 'ACTIVE') … .catch(… logger.warn …)`                                                                                                                                                                                                      |
| P0-6 refund amount unused                       | `zarinpal.adapter.ts` `refundPayment()` posts `{ merchant_id, authority }` only                                                                                                                                                                                                                                     |
| P0-7 tax fail-open                              | `cart-pricing.service.ts:25,57-62`; `tax-calculator.ts` doc comment vs `effectiveRate()`; `seed.ts` setting upsert with `update: {}`                                                                                                                                                                                |
| P0-8 stale prices, `PRICE_CHANGED` unused       | `cart-pricing.service.ts:149` (`basePrice: item.unitPriceSnapshot`); `cart.service.ts` `DEFAULT_CART_TTL_DAYS = 30`; `grep -rn PRICE_CHANGED services packages apps --include=*.ts` → `enums.ts` and the unrelated `PRODUCT_PRICE_CHANGED` audit action only; no `validFrom`/`validTo` read in `cart-checkout/`     |
| P1-12 prescription is shape-checked only        | `checkout.service.ts` `validate()`: `PrescriptionReferenceValidator.validate()` → `invalid_shape` is the only prescription check                                                                                                                                                                                    |
| Retracted `priceAdjustment` claim               | `cart.dto.ts` `CartItemOptionDto` (input) has only `optionType` / `optionKey` / `optionLabel`; `priceAdjustment` appears in the response DTO (line 75), the entity and the repository only; `main.ts:43-44` sets `whitelist: true, forbidNonWhitelisted: true`; no pricing code reads an option's `priceAdjustment` |

One claim was **corrected during this verification** rather than carried forward:
the first draft of the register said `PRESCRIPTION_REFERENCE_UNVERIFIED` had no
emitter. It does — `validate()` emits it for a malformed reference — so P1-12 now
states the real gap (the reference is only shape-checked, never resolved).
Likewise `main` was first described as "up to Phase 009"; `git ls-tree` showed it
stops at Phase 008.

## Phase audit checklist ([`phase-audit-checklist.md`](phase-audit-checklist.md))

| Section                                                                           | Result                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture, Security, Database, API, Frontend/Mobile, RBAC, Validation          | N/A — no code, schema or route changed                                                                                                                                                       |
| Concurrency, Idempotency, Observability, Performance, Migration, Rollback, Backup | N/A — nothing executable changed; the executable proofs for each finding are the acceptance criteria of CP-031 / CP-032                                                                      |
| Testing                                                                           | Automated structural checks above; no unit / e2e added because no behaviour changed. The full suite was not re-run for this phase (nothing it exercises changed) — see baseline note below   |
| CI/CD                                                                             | `validate:structure`, `roadmap:audit`, `format:check` green locally. **A real GitHub Actions run is pending** (draft PR); this phase stays `IMPLEMENTED` until it is green and the PR merged |
| Documentation                                                                     | ADR-030 ✓ · `project-progress.md` ✓ · `roadmap.json` ✓ · governance documents re-synchronised ✓                                                                                              |
| Production readiness                                                              | No new runtime dependency; no state machine touched; no "force complete" path introduced                                                                                                     |

## Environment and honesty notes

1. **What this phase proves and what it does not.** The P0 entries were verified by
   reading code on `develop` and tracing the calls; CP-030 does not execute the
   defects. CP-031 and CP-032 each begin by writing a real-PostgreSQL test that
   fails on `develop` (the reproduction), then fix it.
2. **Unmerged branches were inspected, not re-tested.** Branches 17 / 19 / 28 / 29
   were read (commit subjects, their own audit documents); their tests were not
   re-executed in CP-030, and `roadmap.json` says so in each `unmergedNote`.
3. **Local verification harness.** `binaries.prisma.sh` is unreachable from the
   sandbox this work ran in, so Prisma's native query engine could not be
   downloaded. Behavioural runs (used for the baseline and for CP-031 onward) use a
   git-excluded local client built on the `pg` driver adapter, with a shim that
   maps the adapter's unique-violation shape onto `error.meta.target` (the repo's
   `isUniqueViolationOn` helpers read it). `pnpm install` needed
   `--config.engine-strict=false` locally (Node 22.22.0 vs a transitive
   `jsdom` requirement of ≥ 22.22.2). **Neither is committed; real CI with the
   native engine is the final arbiter.**
4. **Baseline on `develop` before any change** (that harness, fresh database,
   repository CI environment variables): `pnpm test` → 353 / 353 unit;
   `test:e2e` → 219 / 220, the single failure being P2-16
   (`inventory.e2e-spec › reserves stock, decrementing available…`, expected 23 /
   received 25), reproducible in isolation.
5. **`roadmap:audit` ✗ marks.** The per-phase "branch=false" lines for CP-001 –
   CP-016, CP-018 and CP-021 predate this phase: those phase branches were deleted
   on `origin` after merging, and the tool looks for them. Unchanged by CP-030.
6. **No regulatory facts are asserted.** The statutory VAT rate, e-invoice
   requirements, lens taxonomy and warranty policy are recorded as owner decisions
   (roadmap §7 Q3 – Q7), not as constants.

## Gaps found / closed

- **Closed:** P2-15 (governance drift) — `canonical-roadmap.md` rows and
  `roadmap.json` `nextPhase` / `aggregate` corrected.
- **Opened (owned):** P0-3 – P0-8, P1-10 – P1-15, P2-13, P2-14, P2-16 — see
  [`gap-priority-matrix.md`](gap-priority-matrix.md).
- **Still unowned, deliberately:** P1-1 (rate limiting) — a P1, so the structural
  rule does not require an owner, but the roadmap document (§7 Q8) asks the owner to
  assign one before any public storefront.

## Result

**IMPLEMENTED.** All CP-030 deliverables exist, are internally consistent, and pass
the structural checks. Not `VALIDATED`: Definition of Done item 3 (integration into
`develop` with a real CI run) is outstanding by design.
