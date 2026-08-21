# Phase status matrix

Scored per the status model in the Phase 014 audit brief. Two tables:
**executed phases** (the 001–013 numbering actually used in this repo's
history) and **blueprint phases** (the original 15-phase plan in
`docs/product/blueprint.md`). See
[`master-roadmap-audit.md`](master-roadmap-audit.md) for why both exist and
the full evidence behind every row.

Scores are 0–100, evidence-based (§"Scoring model" of the audit brief: no
fabricated numbers). `98` is the production-ready bar per the brief; no row
below claims it.

## Executed phases (001–013)

| Phase | Name                                      | Status           | Score                                 | Evidence                                                                                           | Missing                                                                                                                                   | Risk     |
| ----- | ----------------------------------------- | ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 000   | Product/architecture definition           | VALIDATED        | 85                                    | `docs/product/blueprint.md`, ~7,800 lines, real ERD-level detail                                   | Not re-validated against 14 downstream phases' actual shape                                                                               | LOW      |
| 001   | Monorepo foundation                       | PRODUCTION_READY | 95                                    | Builds, lints, typechecks; CI exercises it every run                                               | —                                                                                                                                         | LOW      |
| 002   | CI/CD quality gate                        | IMPLEMENTED      | 70                                    | 4-job gate real and well-structured                                                                | No Redis service in `test` job (see Phase 014 audit §7); no branch-protection evidence (manual GitHub-admin step, unverifiable from repo) | HIGH     |
| 003   | Database foundation                       | VALIDATED        | 80                                    | 11-schema ERD, real migrations+rollback, seed, backup scripts                                      | ~40% of the 153 models have zero application code (§5 of audit) — scope was speculative, not wrong                                        | MEDIUM   |
| 004   | Identity/RBAC                             | PRODUCTION_READY | 90                                    | Full clean-architecture module, 2FA, audit log, e2e-tested                                         | Rate limiting, OAuth, API-key request auth (documented open items)                                                                        | LOW      |
| 005   | Catalog                                   | VALIDATED        | 88                                    | Full lifecycle state machine, pricing, tested                                                      | Search is Postgres-only by deliberate choice, not OpenSearch                                                                              | LOW      |
| 006   | Inventory                                 | VALIDATED        | 78                                    | Ledger+reservation proven under 100-way concurrency                                                | No Purchase Order / Supplier model (blueprint bullets, absent)                                                                            | MEDIUM   |
| 007   | Cart/checkout                             | VALIDATED        | 88                                    | Real concurrency fix found+proven, pricing pure/unit-tested                                        | —                                                                                                                                         | LOW      |
| 008   | Payment orchestration                     | IMPLEMENTED      | 75                                    | Real ZarinPal adapter, 3 races found+fixed+proven                                                  | Live network path to ZarinPal never verified (sandbox network policy)                                                                     | MEDIUM   |
| 009   | Order/invoice/fulfillment                 | VALIDATED        | 85                                    | Real concurrency race found+fixed, 4 state machines                                                | —                                                                                                                                         | LOW      |
| 010   | Promotion/coupon engine                   | VALIDATED        | 85                                    | Redemption ledger proven under 2 independent concurrency proofs                                    | —                                                                                                                                         | LOW      |
| 011   | Order lifecycle hardening                 | VALIDATED        | 88                                    | Closed a real fulfillment/shipment race, added completion-readiness validator                      | Deliberately deferred restock-on-cancel (documented, re-affirmed)                                                                         | LOW      |
| 012   | Returns/refunds/credit notes              | **BLOCKED**      | 82 (implementation) / 0 (integration) | Full lifecycle, tested, documented — on its own branch                                             | **Not merged to `develop`**                                                                                                               | CRITICAL |
| 013   | Return settlement recovery/reconciliation | **BLOCKED**      | 85 (implementation) / 0 (integration) | State machine, recovery sweep, reconciliation, 2 genuine concurrency bugs found+fixed, 10+5 proofs | **Not merged to `develop`**                                                                                                               | CRITICAL |

Phases 012/013's "BLOCKED" status is specifically about integration, not
implementation quality — the two scores are reported separately because
they answer different questions ("is the code good" vs. "can anyone
actually run it from the branch this repo calls truth"). Resolving the
merge is the single highest-leverage action available (see
[`critical-path.md`](critical-path.md) item 1).

## Blueprint phases (0–14, original plan)

| Phase | Name                     | Status      | Score | Nearest executed work                                                                           | Risk                                                                                 |
| ----- | ------------------------ | ----------- | ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0     | Discovery & Architecture | VALIDATED   | 90    | Phase 000                                                                                       | LOW                                                                                  |
| 1     | Core Infrastructure      | PARTIAL     | 65    | Phases 001–004                                                                                  | MEDIUM (CI/Redis gap)                                                                |
| 2     | Catalog                  | IMPLEMENTED | 88    | Phase 005                                                                                       | LOW                                                                                  |
| 3     | Commerce                 | IMPLEMENTED | 85    | Phases 007–009, 012–013                                                                         | CRITICAL (012/013 unmerged)                                                          |
| 4     | Inventory                | PARTIAL     | 60    | Phase 006                                                                                       | MEDIUM (no Purchase/Supplier)                                                        |
| 5     | Customer                 | SCAFFOLDED  | 10    | Schema only (`customer.*` mostly inert)                                                         | HIGH (no real account/loyalty/wallet/prescription features)                          |
| 6     | CMS                      | SCAFFOLDED  | 5     | Schema only, zero code                                                                          | HIGH (no content-management capability at all)                                       |
| 7     | CRM                      | PARTIAL     | 20    | Phase 010 (coupon slice only)                                                                   | HIGH                                                                                 |
| 8     | Store (POS/omnichannel)  | NOT_STARTED | 0     | none                                                                                            | LOW _now_ (defer explicitly rather than half-build)                                  |
| 9     | Mobile                   | SCAFFOLDED  | 5     | `apps/mobile`/`apps/pwa` scaffolds                                                              | MEDIUM (no client at all yet)                                                        |
| 10    | AI                       | NOT_STARTED | 0     | none                                                                                            | LOW _now_ — do not build speculative AI before the commerce core is client-reachable |
| 11    | Notification             | PARTIAL     | 30    | `services/notification-worker` — real dispatcher/fallback logic, every provider adapter stubbed | MEDIUM (OTP/order-confirmation delivery is currently fake in any real deployment)    |
| 12    | Advanced Analytics       | SCAFFOLDED  | 5     | One event-sink table, no pipeline                                                               | LOW _now_                                                                            |
| 13    | Security Hardening       | PARTIAL     | 40    | RBAC/2FA/audit real; rate-limit/pentest/threat-model absent                                     | HIGH (rate limiting specifically, before any public exposure)                        |
| 14    | Production readiness     | PARTIAL     | 30    | Backup scripts real; monitoring/alerting/DR/runbook/load-test absent                            | HIGH (before any real launch)                                                        |

## Reading this matrix

Do not average the second table into a single "% done" without weighting —
see the audit's §14 for the two weighted figures (unweighted ~35%,
commerce-weighted ~45–50%) and the final report for the full,
separately-reported percentage set (product / engineering / production-
readiness / security / database / Iran-readiness are different axes and
are reported as such).
