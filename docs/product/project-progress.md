# Project Progress Matrix

**Permanent record**, updated at the end of every phase. Scores computed
per [`progress-scoring.md`](progress-scoring.md); status definitions per
[`canonical-roadmap.md`](canonical-roadmap.md). Machine-readable form:
[`roadmap.json`](roadmap.json). Regenerate/verify with `pnpm roadmap:audit`.

Every completion percentage below cites the evidence it came from — see
[`../roadmap/master-roadmap-audit.md`](../roadmap/master-roadmap-audit.md)
for the underlying commands/greps/live reproductions.

## Completed phases (CP-000 – CP-011)

### CP-000 — Product/architecture definition

- **Objective:** Business requirements, competitor analysis, architecture, ERD, API strategy, security model.
- **Dimension scores:** Architecture 100 (redistributed weight — DB/API/Frontend/Mobile N/A, this phase is design-only) · Documentation 100 · all else N/A.
- **Completion:** 90%
- **Database / API / Frontend / Mobile:** N/A (design phase, no code)
- **Security:** 90 (security model designed, not yet implemented — that's every later phase's job)
- **Testing:** N/A · **CI/CD:** N/A · **Production Readiness:** N/A
- **Audit status:** VALIDATED (this document + the Phase 014 audit both re-verified `docs/product/blueprint.md` exists and is ~7,800 lines of real detail)
- **Blocking issues:** none
- **Dependencies:** none
- **Git branch:** N/A (predates the branch-per-phase convention) · **Latest commit:** N/A
- **Next action:** none — superseded by CP-014's canonical roadmap for forward planning

### CP-001 — Monorepo foundation

- **Objective:** Repository, CI/CD scaffold, PostgreSQL/Redis/Docker, initial toolchain.
- **Completion:** 95%
- **Database:** 75 (placeholder schema only, superseded by CP-003) · **Backend/API:** 50 (health + placeholder identity module) · **Frontend/Admin:** 25 (scaffolds only, by design — real work owned by CP-018/020) · **Mobile:** 25 (scaffold only, by design — owned by CP-022) · **Security:** 25 (no real auth yet — CP-004's job) · **Testing:** 75 (structure validation script real and CI-enforced) · **Integration:** 100 (on `develop`) · **Documentation:** 100 · **CI/CD:** 50 (scaffolded, hardened by CP-002) · **Production Readiness:** 50
- **Audit status:** PRODUCTION_READY (as a scaffold — the bar for this phase specifically)
- **Blocking issues:** none
- **Dependencies:** none
- **Git branch:** `01-feature-foundation-monorepo` · **Latest commit:** `0585858`
- **Next action:** none

### CP-002 — CI/CD quality gate

- **Objective:** 4-job CI pipeline (lint/test/security/build) + quality gate + branch strategy.
- **Completion:** 70%
- **Backend/API:** N/A · **Frontend/Admin:** N/A · **Mobile:** N/A · **Security:** 75 (secret scan + dependency audit real) · **Testing:** 100 (the pipeline itself is the deliverable) · **Integration:** 100 · **Documentation:** 100 · **CI/CD:** 50 (**no Redis service in the `test` job — see CP-016**) · **Production Readiness:** 50
- **Audit status:** IMPLEMENTED — real and well-structured, with one confirmed CRITICAL gap (P0, see [`gap-priority-matrix.md`](gap-priority-matrix.md))
- **Blocking issues:** **P0 — CI has no Redis service; app has no fail-fast (empirically reproduced in the Phase 014 audit)**
- **Dependencies:** none
- **Git branch:** `02-feature-ci-pipeline` · **Latest commit:** `8bb4ea9`
- **Next action:** owned by CP-016

### CP-003 — Database foundation

- **Objective:** Full 11-schema Postgres ERD, migrations+rollback, seed, backup/restore.
- **Completion:** 80%
- **Backend/API:** N/A · **Frontend/Admin:** N/A · **Mobile:** N/A · **Security:** 90 (least-privilege roles, real) · **Testing:** 100 (UP/DOWN/UP+shadow-DB round trip, CI re-runs seed as drift check) · **Integration:** 100 · **Documentation:** 100 · **CI/CD:** 100 · **Production Readiness:** 50 (backup scripts real, no restore drill on record — see CP-029)
- **Database:** 60 (~40% of the 153 models have zero application code — deliberate speculative up-front modeling, not a defect, but real unused surface area)
- **Audit status:** VALIDATED
- **Blocking issues:** none (P2 cleanup: prune or build out the unused ~40%)
- **Dependencies:** none
- **Git branch:** `03-feature-database-foundation` · **Latest commit:** `3f7e013`
- **Next action:** none this phase; unused schema addressed by CP-019/023/024/027 as they land

### CP-004 — Identity/RBAC/2FA/audit

- **Completion:** 90%
- **Database:** 100 · **Backend/API:** 100 · **Frontend/Admin:** N/A (CP-018's job) · **Mobile:** N/A (CP-022's job) · **Security:** 90 (rate limiting/OAuth/API-key-request-auth explicitly deferred to CP-016/028) · **Testing:** 100 (2FA round trip, session rotation, permission bypass e2e) · **Integration:** 100 · **Documentation:** 100 · **CI/CD:** 100 · **Production Readiness:** 75
- **Audit status:** PRODUCTION_READY
- **Blocking issues:** none
- **Dependencies:** CP-003
- **Git branch:** `04-feature-identity-authz` · **Latest commit:** `07490ed`
- **Next action:** none this phase; rate limiting owned by CP-016

### CP-005 — Catalog

- **Completion:** 88% (full worked example in [`progress-scoring.md`](progress-scoring.md))
- **Audit status:** VALIDATED
- **Blocking issues:** none
- **Dependencies:** CP-003, CP-004
- **Git branch:** `05-feature-catalog-commerce` · **Latest commit:** `354daa2`
- **Next action:** none

### CP-006 — Inventory core

- **Completion:** 78%
- **Database:** 100 · **Backend/API:** 100 (100-way concurrency proof, no oversell) · **Frontend/Admin:** N/A · **Mobile:** N/A · **Security:** 90 · **Testing:** 100 · **Integration:** 100 · **Documentation:** 100 · **CI/CD:** 50 (shared gap) · **Production Readiness:** 50
- **Audit status:** VALIDATED
- **Blocking issues:** **P1 — no Purchase Order/Supplier model** (owned by CP-021)
- **Dependencies:** CP-003, CP-004, CP-005
- **Git branch:** `06-feature-inventory-warehouse` · **Latest commit:** `db80dd7`
- **Next action:** none this phase; procurement owned by CP-021

### CP-007 — Cart/checkout

- **Completion:** 88%
- **Audit status:** VALIDATED
- **Blocking issues:** none
- **Dependencies:** CP-005, CP-006
- **Git branch:** `07-feature-cart-checkout` · **Latest commit:** `75bdee3`
- **Next action:** none

### CP-008 — Payment orchestration

- **Completion:** 75%
- **Backend/API:** 90 (real ZarinPal adapter, network path unverified — sandbox network policy) · **Testing:** 90 (3 real races found+fixed+proven; live-gateway round trip not verified) · other dimensions as CP-007
- **Audit status:** IMPLEMENTED
- **Blocking issues:** **P1 — live ZarinPal network path never verified** (staging task, not a code gap)
- **Dependencies:** CP-007
- **Git branch:** `08-feature-payment-orchestration` · **Latest commit:** `a7c81a2`
- **Next action:** none this phase; verify on first staging environment with real egress

### CP-009 — Order/invoice/fulfillment

- **Completion:** 85%
- **Audit status:** VALIDATED
- **Blocking issues:** none
- **Dependencies:** CP-005, CP-006, CP-007, CP-008
- **Git branch:** `09-feature-order-fulfillment` · **Latest commit:** `09b99e9`
- **Next action:** none

### CP-010 — Promotion/coupon engine

- **Completion:** 85%
- **Audit status:** VALIDATED
- **Blocking issues:** **P2 — CRM beyond coupon (Segmentation/Campaign/Referral/Automation/Support) not built** (owned by CP-024)
- **Dependencies:** CP-007, CP-009
- **Git branch:** `10-feature-promotion-pricing` · **Latest commit:** `7bef754`
- **Next action:** none this phase

### CP-011 — Order lifecycle hardening

- **Completion:** 88%
- **Audit status:** VALIDATED
- **Blocking issues:** none (deliberately deferred restock-on-cancel, re-affirmed not retrofitted — ADR-011 decision 8)
- **Dependencies:** CP-009
- **Git branch:** `11-feature-order-lifecycle-shipping` · **Latest commit:** `39f5a7b` (= current `develop` HEAD)
- **Next action:** none

## Partial phases (blocked on integration, not on quality)

### CP-012 — Returns/refunds/credit notes

- **Completion:** 82% (implementation) / **0% (integration — not on `develop`)**
- **Database:** 100 · **Backend/API:** 100 · **Security:** 90 · **Testing:** 100 · **Integration:** **0 (blocking)** · **Documentation:** 100 · **CI/CD:** 0 (never run through real CI, since unmerged) · **Production Readiness:** 50
- **Audit status:** IMPLEMENTED, **BLOCKED on integration**
- **Blocking issues:** **P0 — not merged into `develop`** (owned by CP-015)
- **Dependencies:** CP-009
- **Git branch:** `12-feature-returns-refunds-credit-notes` · **Latest commit:** `0d5f913`
- **Next action:** merge into `develop` (CP-015)

### CP-013 — Return settlement recovery/reconciliation

- **Completion:** 85% (implementation) / **0% (integration — not on `develop`)**
- Same shape as CP-012.
- **Blocking issues:** **P0 — not merged into `develop`** (owned by CP-015, same merge as CP-012, in order)
- **Dependencies:** CP-012
- **Git branch:** `13-feature-return-settlement-reconciliation` · **Latest commit:** `443be06`
- **Next action:** merge into `develop` (CP-015)

### CP-014 — Roadmap Audit & Governance (this phase)

- **Completion:** in progress
- **Audit status:** the audit sub-branch (`014-feature-master-roadmap-audit`) is complete and pushed; this governance sub-branch (`14-feature-roadmap-reconciliation`) is the current work
- **Blocking issues:** none — this phase's own output is what unblocks everything else
- **Dependencies:** none (reads everything, changes nothing outside `docs/`, `PROJECT_STATUS.md`, and `pnpm roadmap:audit` tooling)
- **Git branch:** `14-feature-roadmap-reconciliation` · **Latest commit:** (this phase's own commits, see final report)
- **Next action:** produce `phase-014-audit.md`, validate, commit, push, hand off to CP-015

## Planned phases (CP-015 – CP-029) — zero implementation, defined scope

All of the following score **0% on every dimension** — none has any code,
test, or documentation of its own implementation yet (their _planning_
documentation exists in `master-roadmap-v2.md`/`canonical-roadmap.md`,
which is CP-014's output, not theirs). Full objective/deliverables/
acceptance criteria for each: [`../roadmap/master-roadmap-v2.md`](../roadmap/master-roadmap-v2.md)
(as `P015`–`P021`, renumbered `CP-` here) and
[`canonical-roadmap.md`](canonical-roadmap.md) (`CP-022`–`CP-029`).

| CP ID  | Name                            | Priority | Dependencies           | Status      | Next action                                                        |
| ------ | ------------------------------- | -------- | ---------------------- | ----------- | ------------------------------------------------------------------ |
| CP-015 | Integration Reconciliation      | P0       | none                   | NOT_STARTED | Merge CP-012, then CP-013, into `develop`                          |
| CP-016 | Platform Reliability Foundation | P0       | CP-015                 | NOT_STARTED | Redis CI service + fail-fast + rate limit + observability minimums |
| CP-017 | Real Notification Delivery      | P1       | CP-016                 | NOT_STARTED | Wire one real SMS provider                                         |
| CP-018 | Admin Panel MVP                 | P1       | CP-015, CP-016         | NOT_STARTED | First real frontend features                                       |
| CP-019 | Customer Domain & Prescription  | P1       | CP-015, CP-016         | BLOCKED     | Needs optometry-domain-expert review before implementation         |
| CP-020 | Storefront MVP                  | P1       | CP-016, CP-018, CP-019 | NOT_STARTED | First real customer-facing surface                                 |
| CP-021 | Procurement                     | P2       | CP-015                 | NOT_STARTED | Purchase Order/Supplier model                                      |
| CP-022 | Mobile real features            | P2       | CP-018, CP-020         | NOT_STARTED | Sequenced after web UX proven                                      |
| CP-023 | CMS                             | P2       | CP-018                 | NOT_STARTED | Needs admin UI to author content                                   |
| CP-024 | CRM beyond coupons              | P2       | CP-019, CP-020         | NOT_STARTED | Needs real customer data to segment                                |
| CP-025 | Store/POS/omnichannel           | P2       | CP-018, CP-021         | NOT_STARTED | Separate operational model, deferred                               |
| CP-026 | AI                              | P2       | CP-020                 | NOT_STARTED | Needs real usage data                                              |
| CP-027 | Advanced Analytics              | P2       | CP-020                 | NOT_STARTED | Needs real volume                                                  |
| CP-028 | Security Hardening completion   | P1       | CP-016                 | NOT_STARTED | Before any phase is genuinely public                               |
| CP-029 | Production Readiness completion | P1       | CP-016                 | NOT_STARTED | Before any "production-ready" claim                                |

## Aggregate

- **Completed (Implementation+Test+Integration+Docs all met, or the
  design-only equivalent for CP-000):** 12 (CP-000–CP-011)
- **Partial (Implementation+Test+Docs met, Integration missing):** 2 (CP-012, CP-013)
- **In progress:** 1 (CP-014)
- **Planned (zero implementation):** 15 (CP-015–CP-029)
- **Total canonical phases tracked:** 30

This count is the authoritative input to the "Number of completed/
partial/planned phases" figures required in every future phase's final
report — see [`gap-priority-matrix.md`](gap-priority-matrix.md) for what
blocks CP-012/013 from becoming fully Completed, and
[`next-phase-decision.md`](next-phase-decision.md) for what happens next.
