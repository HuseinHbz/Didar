# Project Status

**Overall Progress:** 19 of 40 canonical phases Completed, 0 Partial,
1 in progress (CP-030, implemented and awaiting merge), 20 Planned.
**Current Phase:** CP-030 — Remediation Roadmap & Review Correction
(IMPLEMENTED, documentation only, awaiting merge). It phases the
cross-functional review into CP-031 – CP-039 and records six new open P0
gaps (P0-3 – P0-8), each with an owning phase. Previously merged and
VALIDATED: CP-016, CP-018, CP-021 (see
`docs/product/integration-cp016-cp021.md` and
`docs/product/integration-cp018.md`).
**Next Phase:** **CP-031 — Payment/Order/Inventory Consistency** (P0; all
dependencies met; no external decision needed). CP-032 — Pricing & Tax
Integrity (P0) follows, and CP-037 — Persian-aware Search is also ready.
CP-033, CP-035, CP-036, CP-038 and CP-039 are BLOCKED on owner / domain
decisions (the eight questions in `docs/product/remediation-roadmap.md` §7);
CP-034 waits on CP-019. Four finished phases are **not integrated**: CP-017
(real SMS, validation-blocked), CP-019 (prescription domain, held behind five
owner decisions), CP-028 (API-key auth / key rotation) and CP-029
(`/metrics`, alerting, runbook) are complete on their own branches
(`unmergedBranch` in `roadmap.json`); integrating them is CP-039. See
`docs/product/phase-dependency-graph.md`.
**Last Audit:** 2026-10-24 (`docs/product/phase-030-audit.md`); earlier:
2026-08-22 (`docs/product/phase-016-audit.md`,
`docs/product/phase-018-audit.md`, `docs/product/phase-021-audit.md`,
`docs/product/phase-017-validation-audit.md`).

This file is a human-readable summary. The source of truth is
[`docs/product/roadmap.json`](docs/product/roadmap.json), kept in sync by
[`pnpm roadmap:audit`](docs/product/phase-governance.md). Full detail per
phase: [`docs/product/project-progress.md`](docs/product/project-progress.md).
Legend: `[x]` Completed · `[~]` In progress / Partial · `[ ]` Planned ·
`[!]` Blocked.

## Foundation

- [x] CP-000 — Product/architecture definition
- [x] CP-001 — Monorepo foundation
- [x] CP-002 — CI/CD quality gate
- [x] CP-003 — Database foundation
- [x] CP-004 — Identity/RBAC/2FA/audit

## Commerce core

- [x] CP-005 — Catalog
- [x] CP-006 — Inventory core
- [x] CP-007 — Cart/checkout
- [x] CP-008 — Payment orchestration
- [x] CP-009 — Order/invoice/fulfillment
- [x] CP-010 — Promotion/coupon engine
- [x] CP-011 — Order lifecycle hardening
- [x] CP-012 — Returns/refunds/credit notes _(integrated by CP-015)_
- [x] CP-013 — Return settlement recovery/reconciliation _(integrated by CP-015)_
- [x] CP-021 — Procurement _(`21-feature-procurement`, branched directly off `develop` — its sole canonical dependency is CP-015, verified empirically; completed out of numeric order per that dependency, not by skipping the CP-016 gate)_

## Governance & integration

- [x] CP-014 — Roadmap Audit & Governance
- [x] CP-015 — Integration Reconciliation _(merged CP-012/013/014, fresh-DB zero-drift proven, 195/195 e2e twice consecutively)_
- [x] CP-016 — Platform Reliability Foundation _(real Redis CI service, bounded startup preflight in all 3 Redis-dependent services, `/health/ready` split, all live-proven twice against a real Redis; rate limiting (P1-1) and full observability (P1-5) explicitly deferred by this phase's own non-goals)_

## Client applications

- [x] CP-018 — Admin Panel MVP _(this phase — real operator UI over the pre-existing, RBAC-gated backend: auth, permission-aware nav, catalog/inventory/order/return operator views; zero new backend business logic beyond a CORS config widening; 12/12 e2e + 16/16 unit tests, run twice; see `docs/product/phase-018-audit.md`)_

## Planned — active tracks (the gate is closed)

- [ ] CP-017 — Real Notification Delivery _(IMPLEMENTED / VALIDATION-BLOCKED on sibling branch `17-feature-real-notification-delivery`, not merged — see `docs/product/phase-017-validation-audit.md`)_
- [!] CP-019 — Customer Domain & Prescription _(blocked on domain-expert review)_
- [ ] CP-020 — Storefront MVP _(needs CP-019, still blocked)_

## Planned — deferred tracks

- [ ] CP-022 — Mobile real features
- [ ] CP-023 — CMS
- [ ] CP-024 — CRM beyond coupons
- [ ] CP-025 — Store/POS/omnichannel
- [ ] CP-026 — AI
- [ ] CP-027 — Advanced Analytics
- [ ] CP-028 — Security Hardening completion
- [ ] CP-029 — Production Readiness completion

## Remediation series (CP-030 – CP-039)

- [~] CP-030 — Remediation Roadmap & Review Correction _(this phase — implemented, awaiting merge; see `docs/product/remediation-roadmap.md`)_
- [ ] CP-031 — Payment/Order/Inventory Consistency _(P0, ready)_
- [ ] CP-032 — Pricing & Tax Integrity _(P0, ready)_
- [!] CP-033 — Optical Catalog & Lens Pricing _(blocked: optician decisions)_
- [ ] CP-034 — Prescription at Purchase _(needs CP-019, CP-033)_
- [!] CP-035 — Lab Operations & Warranty _(blocked: lab / warranty policy)_
- [!] CP-036 — Tax Invoice & Currency Presentation _(blocked: finance / legal scoping)_
- [ ] CP-037 — Persian-aware Search _(ready)_
- [!] CP-038 — Virtual Try-On _(blocked: "VR 5D" undefined)_
- [!] CP-039 — Integration of Finished Phases & Release Sync _(blocked: owner merge decisions)_

## P0 blockers open right now

Six, all found by the CP-030 review and each owned by a scoped phase (the
governance rule — no P0 without an owner — is satisfied):

- `P0-3` checkout hold shorter than the payment window; expiry sweep ignores
  live payments — **CP-031**
- `P0-4` a payment verified after its checkout expired yields no order unless
  the customer returns — **CP-031**
- `P0-5` an order can be `PAID` with no stock allocated; failures swallowed —
  **CP-031**
- `P0-6` partial refunds sent to ZarinPal `reverse.json` without an amount —
  **CP-031**
- `P0-7` tax fails open (missing setting → 0 %) — **CP-032**
- `P0-8` cart prices frozen at add-to-cart for up to 30 days; `PRICE_CHANGED`
  never emitted — **CP-032**

Resolved earlier: `CP-012/013 not on develop` (CP-015, see
`docs/product/integration-reconciliation.md`) and `CI has no Redis service`
(CP-016, see `docs/product/phase-016-audit.md`).

Full gap list with priorities and owners: [`docs/product/gap-priority-matrix.md`](docs/product/gap-priority-matrix.md).
