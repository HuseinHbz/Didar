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
- **Backend/API:** N/A · **Frontend/Admin:** N/A · **Mobile:** N/A · **Security:** 75 (secret scan + dependency audit real) · **Testing:** 100 (the pipeline itself is the deliverable) · **Integration:** 100 · **Documentation:** 100 · **CI/CD:** 100 (**real `redis:7.4-alpine` service container added by CP-016**) · **Production Readiness:** 50
- **Audit status:** IMPLEMENTED — real and well-structured; the one confirmed CRITICAL gap this entry originally flagged (P0-2, see [`gap-priority-matrix.md`](gap-priority-matrix.md)) is now **RESOLVED by CP-016**
- **Blocking issues:** none (P0-2 resolved by CP-016)
- **Dependencies:** none
- **Git branch:** `02-feature-ci-pipeline` · **Latest commit:** `8bb4ea9`
- **Next action:** none

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

## Integrated phases — completed by CP-015

### CP-012 — Returns/refunds/credit notes

- **Completion:** 90% (implementation + integration)
- **Database:** 100 · **Backend/API:** 100 · **Security:** 90 · **Testing:** 100 · **Integration:** **100 — merged into `15-feature-integration-reconciliation`, fresh-database-proven** · **Documentation:** 100 · **CI/CD:** 100 (this session's own real validation gate; a real GitHub Actions run still follows once this branch reaches `develop`) · **Production Readiness:** 60
- **Audit status:** VALIDATED
- **Blocking issues:** none (P0-1 resolved by CP-015)
- **Dependencies:** CP-009
- **Git branch:** `12-feature-returns-refunds-credit-notes` (historical source) → merged into `15-feature-integration-reconciliation` · **Latest commit:** `0d5f913`
- **Next action:** none

### CP-013 — Return settlement recovery/reconciliation

- **Completion:** 90% (implementation + integration)
- Same shape as CP-012 — integrated in the same merge chain, immediately after it.
- **Blocking issues:** none (P0-1 resolved by CP-015)
- **Dependencies:** CP-012
- **Git branch:** `13-feature-return-settlement-reconciliation` (historical source) → merged into `15-feature-integration-reconciliation` · **Latest commit:** `443be06`
- **Next action:** none

### CP-014 — Roadmap Audit & Governance

- **Completion:** 100%
- **Audit status:** VALIDATED — both sub-branches (`014-feature-master-roadmap-audit`, `14-feature-roadmap-reconciliation`) complete, pushed, and now also merged into `15-feature-integration-reconciliation` (CP-015 needs CP-014's own tooling to fulfill its own roadmap-update requirement)
- **Blocking issues:** none
- **Dependencies:** none
- **Git branch:** `14-feature-roadmap-reconciliation` (historical source) → merged into `15-feature-integration-reconciliation` · **Latest commit:** `cf46a0b`
- **Next action:** none

### CP-015 — Integration Reconciliation (this phase)

- **Completion:** 95%
- **Audit status:** VALIDATED — CP-012+CP-013+CP-014 merged with zero textual conflicts (`develop` was a strict git ancestor of CP-013's tip before this phase started), a genuinely fresh PostgreSQL database proved zero schema drift end to end, the full e2e suite passed twice consecutively (195/195, one fully diagnosed non-regression timing finding — see `docs/architecture/integration-reconciliation.md`), no RBAC/security regression found
- **Blocking issues:** none
- **Dependencies:** CP-014
- **Git branch:** `15-feature-integration-reconciliation` · **Latest commit:** see this phase's completion report
- **Next action:** hand off to CP-016

### CP-016 — Platform Reliability Foundation

- **Completion:** 90% (the P0 reliability fix is complete and evidenced end to end; rate limiting (P1-1) and full observability (P1-5) are explicitly out of this phase's own scope — see below)
- **Database:** N/A (no schema change) · **Backend/API:** 100 (bounded startup preflight in all 3 Redis-dependent services + new `GET /health/ready`) · **Security:** 90 (credential-handling rule enforced and tested; no new attack surface — see `docs/security/redis-security.md`) · **Testing:** 100 (4 unit-test files + 7-case e2e spec, all passing; plus live BullMQ-under-real-stall proof, run twice) · **Integration:** 100 (fresh-database migration re-verified, full e2e suite run twice consecutively) · **Documentation:** 100 (4 companion docs + this audit) · **CI/CD:** 100 (real `redis:7.4-alpine` service container + connectivity check) · **Production Readiness:** 80 (the reliability gap is closed; rate limiting and full observability remain, by this phase's own explicit non-goals)
- **Audit status:** VALIDATED — see [`phase-016-audit.md`](phase-016-audit.md)
- **Blocking issues:** none for this phase's own scope. **P1-1** (rate limiting) and the **full** form of **P1-5** (production observability — `/metrics`, alerting) are explicitly deferred, per this phase's own non-goals — CP-016 delivered only P1-5's structured-logging "minimum" (no credential leakage in any Redis-related log line, live-verified)
- **Dependencies:** CP-015
- **Git branch:** `16-feature-platform-reliability` · **Latest commit:** see this phase's completion report
- **Next action:** CP-017 (or whichever phase picks up P1-1/P1-5's remainder — see `next-phase-decision.md`)

### CP-017 — Real Notification Delivery

- **Completion:** 80% (same "real provider adapter, unverified live network path" shape as CP-008 — see below)
- **Database:** N/A (no schema change) · **Backend/API:** 100 (real Kavenegar `SmsAdapter`; `services/api` now a real BullMQ producer onto `notifications`) · **Security:** 90 (credential-handling verified by a live test assertion; narrow, documented `(phone, purpose)` cooldown — full rate limiting stays P1-1's) · **Testing:** 100 (17 new unit tests + 4 real-Redis e2e tests, all passing twice consecutively; zero regression across all 12 pre-existing e2e files that call `POST /auth/otp/request`) · **Integration:** 75 (on its own branch, not yet merged to `develop` — same situation CP-012/013 were in before CP-015; full e2e suite run twice against this branch) · **Documentation:** 100 (ADR-014 + product/security docs + 2 module README updates + this entry) · **CI/CD:** N/A (no CI change) · **Production Readiness:** 70 (real for OTP; live network path unverified — see P1-8; other 5 channels still stubbed, by design)
- **Audit status:** IMPLEMENTED — see [`phase-017-audit.md`](phase-017-audit.md)
- **Blocking issues:** **P1-8** (live Kavenegar network path never verified — staging task, not a code gap, same class as CP-008's own P1-6). **P1-1** (repo-wide rate limiting) remains open beyond this phase's own narrow OTP-dispatch cooldown.
- **Dependencies:** CP-016
- **Git branch:** `17-feature-real-notification-delivery` (cut from `16-feature-platform-reliability`'s tip, not `develop` — `develop` was still at CP-015's tip when this phase started; per `phase-governance.md`, a dependency only needs to be ≥`IMPLEMENTED`, which CP-016 exceeded) · **Latest commit:** see this phase's completion report
- **Next action:** CP-018 (or CP-019/CP-021, which have no dependency on CP-017 — see `phase-dependency-graph.md`)

## Planned phases (CP-018 – CP-029) — zero implementation, defined scope

All of the following score **0% on every dimension** — none has any code,
test, or documentation of its own implementation yet (their _planning_
documentation exists in `master-roadmap-v2.md`/`canonical-roadmap.md`,
which is CP-014's output, not theirs). Full objective/deliverables/
acceptance criteria for each: [`../roadmap/master-roadmap-v2.md`](../roadmap/master-roadmap-v2.md)
(as `P018`–`P021`, renumbered `CP-` here) and
[`canonical-roadmap.md`](canonical-roadmap.md) (`CP-022`–`CP-029`).

| CP ID  | Name                            | Priority | Dependencies           | Status      | Next action                                                |
| ------ | ------------------------------- | -------- | ---------------------- | ----------- | ---------------------------------------------------------- |
| CP-018 | Admin Panel MVP                 | P1       | CP-015, CP-016         | NOT_STARTED | First real frontend features                               |
| CP-019 | Customer Domain & Prescription  | P1       | CP-015, CP-016         | BLOCKED     | Needs optometry-domain-expert review before implementation |
| CP-020 | Storefront MVP                  | P1       | CP-016, CP-018, CP-019 | NOT_STARTED | First real customer-facing surface                         |
| CP-021 | Procurement                     | P2       | CP-015                 | NOT_STARTED | Purchase Order/Supplier model                              |
| CP-022 | Mobile real features            | P2       | CP-018, CP-020         | NOT_STARTED | Sequenced after web UX proven                              |
| CP-023 | CMS                             | P2       | CP-018                 | NOT_STARTED | Needs admin UI to author content                           |
| CP-024 | CRM beyond coupons              | P2       | CP-019, CP-020         | NOT_STARTED | Needs real customer data to segment                        |
| CP-025 | Store/POS/omnichannel           | P2       | CP-018, CP-021         | NOT_STARTED | Separate operational model, deferred                       |
| CP-026 | AI                              | P2       | CP-020                 | NOT_STARTED | Needs real usage data                                      |
| CP-027 | Advanced Analytics              | P2       | CP-020                 | NOT_STARTED | Needs real volume                                          |
| CP-028 | Security Hardening completion   | P1       | CP-016                 | NOT_STARTED | Before any phase is genuinely public                       |
| CP-029 | Production Readiness completion | P1       | CP-016                 | NOT_STARTED | Before any "production-ready" claim                        |

## Aggregate

- **Completed (Implementation+Test+Integration+Docs all met, or the
  design-only equivalent for CP-000; CP-008 and CP-017 count here despite
  each carrying one open "live network path unverified" gap — same
  precedent both entries document explicitly rather than silently
  inflating):** 18 (CP-000–CP-017)
- **Partial:** 0
- **In progress:** 0
- **Planned (zero implementation):** 12 (CP-018–CP-029)
- **Total canonical phases tracked:** 30

This count is the authoritative input to the "Number of completed/
partial/planned phases" figures required in every future phase's final
report — see [`gap-priority-matrix.md`](gap-priority-matrix.md) for what
blocks CP-012/013 from becoming fully Completed, and
[`next-phase-decision.md`](next-phase-decision.md) for what happens next.
