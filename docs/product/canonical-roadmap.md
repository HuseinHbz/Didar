# Canonical Roadmap

**Purpose:** the single roadmap this repository treats as truth. Produced
by Phase 14 (Roadmap Reconciliation & Product Governance), built directly
on Phase 014's audit ([`docs/roadmap/master-roadmap-audit.md`](../roadmap/master-roadmap-audit.md)
and its 10 companion documents — re-cited here, not re-derived, since
nothing in the repository changed between that audit and this
reconciliation). Machine-readable form: [`roadmap.json`](roadmap.json).
Progress tracking: [`project-progress.md`](project-progress.md). Scoring
method: [`progress-scoring.md`](progress-scoring.md).

## Why a "Canonical Product Phase ID" exists

Three numbering schemes have existed in this repository at various points:

1. **Blueprint phases** (`docs/product/blueprint.md` PHASE 0–14) — the
   original 15-phase business-capability plan.
2. **Git/engineering phases** (`01-feature-foundation-monorepo` through
   `13-feature-return-settlement-reconciliation`, plus `Phase 000` for the
   blueprint itself) — the finer-grained numbering actually used to build
   the 8 real backend modules.
3. **This session's own audit branch**, named `014-feature-master-roadmap-audit`
   (three-digit prefix) — inconsistent with the two-digit convention every
   other git-phase branch uses (`01`–`13`). This reconciliation's own
   branch, `14-feature-roadmap-reconciliation`, corrects that back to the
   established two-digit convention.

None of these three are retired or renamed — historical git branch names
and blueprint phase numbers are **preserved exactly as they are**, per
this phase's own instruction not to erase history. Instead, a fourth,
**canonical** identifier — `CP-XXX` — is introduced as the one ID every
future document, `roadmap.json`, and the `pnpm roadmap:audit` tool
actually track against. Every existing document keeps working unchanged;
`CP-XXX` is additive.

## Canonical Product Phase ID assignment

| CP ID  | Name                                      | Git phase(s)                                                                                                                                                                                     | Blueprint phase(s)                                                      | Status                                                                                         |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CP-000 | Product/architecture definition           | Phase 000                                                                                                                                                                                        | PHASE 0                                                                 | VALIDATED                                                                                      |
| CP-001 | Monorepo foundation                       | `01-feature-foundation-monorepo`                                                                                                                                                                 | PHASE 1 (partial: repo/Docker/Redis scaffold)                           | PRODUCTION_READY                                                                               |
| CP-002 | CI/CD quality gate                        | `02-feature-ci-pipeline`                                                                                                                                                                         | PHASE 1 (CI/CD)                                                         | IMPLEMENTED                                                                                    |
| CP-003 | Database foundation                       | `03-feature-database-foundation`                                                                                                                                                                 | PHASE 1 (PostgreSQL); PHASE 14 (Backup, partial)                        | VALIDATED                                                                                      |
| CP-004 | Identity/RBAC/2FA/audit                   | `04-feature-identity-authz`                                                                                                                                                                      | PHASE 1 (Auth); PHASE 5 (Account, partial); PHASE 13 (RBAC/2FA/Audit)   | PRODUCTION_READY                                                                               |
| CP-005 | Catalog                                   | `05-feature-catalog-commerce`                                                                                                                                                                    | PHASE 2                                                                 | VALIDATED                                                                                      |
| CP-006 | Inventory core                            | `06-feature-inventory-warehouse`                                                                                                                                                                 | PHASE 4 (Warehouse/Stock/Ledger/Transfer)                               | VALIDATED                                                                                      |
| CP-007 | Cart/checkout                             | `07-feature-cart-checkout`                                                                                                                                                                       | PHASE 3 (Cart, Checkout)                                                | VALIDATED                                                                                      |
| CP-008 | Payment orchestration                     | `08-feature-payment-orchestration`                                                                                                                                                               | PHASE 3 (Payments)                                                      | IMPLEMENTED                                                                                    |
| CP-009 | Order/invoice/fulfillment                 | `09-feature-order-fulfillment`                                                                                                                                                                   | PHASE 3 (Orders, Shipping, Invoice)                                     | VALIDATED                                                                                      |
| CP-010 | Promotion/coupon engine                   | `10-feature-promotion-pricing`                                                                                                                                                                   | PHASE 7 (Coupon only)                                                   | VALIDATED                                                                                      |
| CP-011 | Order lifecycle hardening                 | `11-feature-order-lifecycle-shipping`                                                                                                                                                            | (hardening, no blueprint phase)                                         | VALIDATED                                                                                      |
| CP-012 | Returns/refunds/credit notes              | `12-feature-returns-refunds-credit-notes`                                                                                                                                                        | PHASE 3 (not a named blueprint bullet)                                  | **BLOCKED** (not merged to `develop`)                                                          |
| CP-013 | Return settlement recovery/reconciliation | `13-feature-return-settlement-reconciliation`                                                                                                                                                    | (hardening on CP-012)                                                   | **BLOCKED** (not merged to `develop`)                                                          |
| CP-014 | Roadmap Audit & Governance (this phase)   | `014-feature-master-roadmap-audit` (audit sub-branch, non-conforming 3-digit name, kept as-is) + `14-feature-roadmap-reconciliation` (this branch, governance sub-phase, canonical 2-digit name) | (meta — audits all of the above)                                        | IN_PROGRESS                                                                                    |
| CP-015 | Integration Reconciliation                | _(not yet branched)_                                                                                                                                                                             | —                                                                       | NOT_STARTED                                                                                    |
| CP-016 | Platform Reliability Foundation           | _(not yet branched)_                                                                                                                                                                             | PHASE 1 (Logging/Monitoring remainder); PHASE 13 (Rate Limit remainder) | NOT_STARTED                                                                                    |
| CP-017 | Real Notification Delivery                | `17-feature-real-notification-delivery`                                                                                                                                                          | PHASE 11 (remainder beyond architecture)                                | IMPLEMENTED (SMS only; live network path unverified — see gap P1-8, same class as CP-008/P1-6) |
| CP-018 | Admin Panel MVP                           | _(not yet branched)_                                                                                                                                                                             | — (enables reachability of CP-001–013)                                  | NOT_STARTED                                                                                    |
| CP-019 | Customer Domain & Prescription            | _(not yet branched)_                                                                                                                                                                             | PHASE 5 (remainder beyond Account)                                      | BLOCKED (needs domain-expert review)                                                           |
| CP-020 | Storefront MVP                            | _(not yet branched)_                                                                                                                                                                             | PHASE 9 (PWA reachability, partial)                                     | NOT_STARTED                                                                                    |
| CP-021 | Procurement (Purchase Orders/Supplier)    | _(not yet branched)_                                                                                                                                                                             | PHASE 4 (remainder)                                                     | NOT_STARTED                                                                                    |
| CP-022 | Mobile real features                      | _(not yet branched)_                                                                                                                                                                             | PHASE 9 (Android/Camera/DeepLink remainder)                             | NOT_STARTED                                                                                    |
| CP-023 | CMS                                       | _(not yet branched)_                                                                                                                                                                             | PHASE 6                                                                 | NOT_STARTED                                                                                    |
| CP-024 | CRM beyond coupons                        | _(not yet branched)_                                                                                                                                                                             | PHASE 7 (remainder)                                                     | NOT_STARTED                                                                                    |
| CP-025 | Store/POS/omnichannel                     | _(not yet branched)_                                                                                                                                                                             | PHASE 8                                                                 | NOT_STARTED                                                                                    |
| CP-026 | AI                                        | _(not yet branched)_                                                                                                                                                                             | PHASE 10                                                                | NOT_STARTED                                                                                    |
| CP-027 | Advanced Analytics                        | _(not yet branched)_                                                                                                                                                                             | PHASE 12                                                                | NOT_STARTED                                                                                    |
| CP-028 | Security Hardening completion             | _(not yet branched)_                                                                                                                                                                             | PHASE 13 (PenTest/OWASP/ThreatModel/KMS remainder)                      | NOT_STARTED                                                                                    |
| CP-029 | Production Readiness completion           | _(not yet branched)_                                                                                                                                                                             | PHASE 14 (remainder beyond Backup)                                      | NOT_STARTED                                                                                    |

CP-015 through CP-029 were first defined in the Phase 014 audit's
[`master-roadmap-v2.md`](../roadmap/master-roadmap-v2.md) as `P015`–`P021`
(plus an undetailed deferred-track table for the rest). **This document
renumbers them into the `CP-` scheme for consistency — the content,
dependencies, and acceptance criteria defined there are unchanged, only
the ID prefix changes** (`P015` → `CP-015`, etc.), and the deferred-track
table is now given explicit IDs (`CP-022`–`CP-029`) instead of being left
unnumbered. `master-roadmap-v2.md` itself is left as-is (historical
document, not rewritten) — `roadmap.json` and every document from here
forward use `CP-` as the one live identifier.

## One owner per capability

Per this phase's own rule, every fine-grained capability (not just every
blueprint-phase bucket, which is too coarse to assign single ownership)
has exactly one owning `CP-XXX`:

| Capability                                                    | Owner  |
| ------------------------------------------------------------- | ------ |
| Repository/toolchain/Docker                                   | CP-001 |
| CI/CD                                                         | CP-002 |
| PostgreSQL schema/migrations                                  | CP-003 |
| Backup/restore scripts                                        | CP-003 |
| Auth (login/2FA/sessions)/RBAC/audit log                      | CP-004 |
| Rate limiting                                                 | CP-016 |
| Logging/Monitoring (metrics, alerting)                        | CP-016 |
| Catalog (product/category/brand/pricing)                      | CP-005 |
| Inventory (warehouse/stock/ledger/transfer/reservation)       | CP-006 |
| Procurement (Purchase Order/Supplier)                         | CP-021 |
| Cart/Checkout/pricing resolution                              | CP-007 |
| Payment orchestration (ZarinPal)                              | CP-008 |
| Order/Invoice/Fulfillment/Shipment                            | CP-009 |
| Coupon/Promotion engine                                       | CP-010 |
| CRM (Segmentation/Campaign/Referral/Automation/Support)       | CP-024 |
| Returns/Refunds/Credit Notes                                  | CP-012 |
| Return Settlement Recovery/Reconciliation                     | CP-013 |
| Customer account beyond auth (Family/Wishlist/Loyalty/Wallet) | CP-019 |
| Prescription domain                                           | CP-019 |
| CMS (Page/Banner/Article/FAQ)                                 | CP-023 |
| Store/POS/omnichannel                                         | CP-025 |
| Mobile (Android real features)                                | CP-022 |
| PWA/Storefront reachability                                   | CP-020 |
| Admin panel reachability                                      | CP-018 |
| Notification real delivery (SMS/Telegram/WhatsApp/Email/Push) | CP-017 |
| AI                                                            | CP-026 |
| Advanced Analytics                                            | CP-027 |
| Penetration testing/threat model/OWASP pass/KMS rotation      | CP-028 |
| Load testing/DR/runbook/incident response                     | CP-029 |
| Roadmap governance itself                                     | CP-014 |

## Duplicate/merged phase handling

No duplicate _capability_ ownership was found — the audit's implementation
matrix confirmed no module re-implements another module's domain logic.
The only duplication found was **git ref duplication** (8 stale
`feature/*` branches, byte-identical to their numbered `NN-feature-*`
replacements — see the audit's §3) — a git-hygiene item, not a capability
conflict. These are recommended for deletion (see
[`gap-priority-matrix.md`](gap-priority-matrix.md), P2) but their history
is not being rewritten by this document; deletion of a ref that is
byte-identical to a kept ref discards no commits.

## Partial vs. Planned

Per this phase's rule, "Completed" requires Implementation + Test +
Integration + Documentation together — file or route existence alone is
never sufficient. Applying that bar:

- **CP-000 through CP-011**: Completed (all four bars met, verified in the
  audit's implementation matrix — domain unit tests, concurrency/e2e
  suites, real DI wiring, and a documentation set per phase).
- **CP-012, CP-013**: merged into `develop` by CP-015 (`docs/product/
integration-reconciliation.md`) — Integration is now met; see
  `project-progress.md`'s own CP-012/013 entries for current status.
- **CP-014, CP-015, CP-016**: Completed — see `project-progress.md` and
  each phase's own `phase-0NN-audit.md`.
- **CP-017**: Implemented, not Completed — real Kavenegar SMS adapter and
  producer wiring exist, tested, documented, but on its own branch (not
  yet merged to `develop` — same "not yet integrated" situation CP-012/013
  were in before CP-015) and with one unverified live-network-egress gap
  (P1-8), the same class of gap CP-008 itself still carries (P1-6). See
  `docs/product/phase-017-audit.md`.
- **CP-018 through CP-029**: **Planned** — defined (objective, deliverables,
  acceptance criteria exist in `master-roadmap-v2.md`/this document) but
  zero implementation exists for any of them. None are miscategorized as
  further along than that.

Full per-phase detail: [`project-progress.md`](project-progress.md).
