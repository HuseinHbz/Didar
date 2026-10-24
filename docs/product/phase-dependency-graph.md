# Phase Dependency Graph

Dependencies as actually implemented (verified via each module's real
imports — e.g. `order` importing `CartCheckoutModule`/`CatalogModule`/
`InventoryModule`/`PaymentModule` directly, per the Phase 014 audit's
architecture review), not assumed from phase order. Planned-phase
dependencies are declared, not yet verified by code (nothing to verify
yet).

## Graph (text form — dependency arrows point from prerequisite to dependent)

```
CP-000 (blueprint)
  └─▶ CP-001 (monorepo foundation)
        ├─▶ CP-002 (CI/CD)
        └─▶ CP-003 (database foundation)
              └─▶ CP-004 (identity/RBAC)
                    └─▶ CP-005 (catalog)
                          └─▶ CP-006 (inventory)
                                └─▶ CP-007 (cart/checkout)
                                      ├─▶ CP-008 (payment)
                                      │     └─▶ CP-009 (order/invoice/fulfillment)
                                      │           ├─▶ CP-010 (promotion/coupon)
                                      │           ├─▶ CP-011 (order lifecycle hardening)
                                      │           └─▶ CP-012 (returns/refunds)
                                      │                 └─▶ CP-013 (settlement recovery)
                                      └─▶ (CP-009, same node — cart/checkout feeds order directly too)

CP-014 (roadmap audit & governance) ─▶ reads all of the above, blocks nothing, gates everything downstream

CP-015 (integration reconciliation) ── depends on: CP-012, CP-013 existing (done) ── **DONE**, unblocked everything below
  └─▶ CP-016 (platform reliability foundation) ── **DONE** (P0-2 resolved; P1-1/P1-5's full form explicitly deferred, not blocking) ── unblocks everything below
        ├─▶ CP-017 (real notification delivery)
        ├─▶ CP-018 (admin panel)
        │     ├─▶ CP-023 (CMS)
        │     └─▶ CP-025 (store/POS) [also needs CP-021]
        ├─▶ CP-019 (customer domain/prescription) [BLOCKED on domain-expert review]
        │     └─▶ CP-024 (CRM beyond coupons) [also needs CP-020]
        ├─▶ CP-021 (procurement) [only needs CP-015, not CP-016 — can start in parallel]
        ├─▶ CP-028 (security hardening completion)
        └─▶ CP-029 (production readiness completion)

CP-018 + CP-019 ─▶ CP-020 (storefront)
  └─▶ CP-022 (mobile real features) [also needs CP-018]
  └─▶ CP-026 (AI) [needs real usage data]
  └─▶ CP-027 (advanced analytics) [needs real usage data]

CP-014 + CP-015 ─▶ CP-030 (remediation roadmap — docs only) ── **IMPLEMENTED**, defines the series below
  ├─▶ CP-031 (payment/order/inventory consistency) [P0, ready]
  │     merge before CP-032: both edit checkout.service.ts (merge order, not a hard dependency)
  ├─▶ CP-032 (pricing & tax integrity) [P0, ready]
  │     ├─▶ CP-033 (optical catalog & lens pricing) [BLOCKED: optician decisions]
  │     │     ├─▶ CP-034 (prescription at purchase) [also needs CP-019]
  │     │     │     └─▶ CP-035 (lab operations & warranty) [BLOCKED: lab/warranty policy]
  │     │     └─▶ CP-038 (virtual try-on) [also needs CP-020; BLOCKED: "VR 5D" undefined]
  │     └─▶ CP-036 (tax invoice & currency presentation) [BLOCKED: finance/legal scoping]
  └─▶ CP-037 (Persian-aware search) [ready]

CP-039 (integration of finished phases & release sync) ── independent, BLOCKED on owner merge decisions
```

## Dependency table by domain

| Domain                                           | Depends on                     | Because                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Database** (CP-003)                            | CP-001                         | Needs the monorepo/toolchain to exist first                                                                                                                                                                                          |
| **Identity/RBAC** (CP-004)                       | CP-003                         | Every table it needs lives in `identity` schema, created by CP-003                                                                                                                                                                   |
| **Commerce** (CP-007/008/009/012/013)            | CP-004, CP-005, CP-006         | Every commerce route is RBAC-gated or ownership-checked (CP-004); references real SKUs (CP-005) and real stock (CP-006)                                                                                                              |
| **Inventory** (CP-006)                           | CP-003, CP-004, CP-005         | Ledger schema (CP-003), admin RBAC (CP-004), SKU identity reused not duplicated (CP-005)                                                                                                                                             |
| **Finance** (CP-008, CP-009's invoice half)      | CP-007                         | Payment/invoice both require a real checkout session to attach to                                                                                                                                                                    |
| **Notification** (CP-017)                        | CP-016                         | Real provider credentials need the secret-handling convention CP-016 doesn't change but the rate-limit/observability minimums should land first so a real SMS integration isn't the first thing exposed to an unbounded request rate |
| **CMS** (CP-023)                                 | CP-018                         | Zero value without an admin UI to author content                                                                                                                                                                                     |
| **Analytics** (CP-027)                           | CP-020                         | Meaningless without real customer/order volume, which requires a reachable storefront                                                                                                                                                |
| **Mobile** (CP-022)                              | CP-018, CP-020                 | Deliberately sequenced after the same UX is proven once on web, per the roadmap's own "do not build the same product twice in parallel" reasoning                                                                                    |
| **Payment/Order/Inventory consistency** (CP-031) | CP-030, CP-007, CP-008, CP-009 | Edits the cart-checkout expiry sweep, the payment intent/refund path and order conversion; cannot be safely changed without the modules it composes already existing                                                                 |
| **Pricing & tax integrity** (CP-032)             | CP-030, CP-005, CP-007         | Enforces catalog price windows and tax inside the cart-checkout pricing pipeline                                                                                                                                                     |
| **Optical catalog & lens pricing** (CP-033)      | CP-032, CP-005                 | Lens surcharges extend the pricing pipeline CP-032 hardens first; lens taxonomy extends catalog attributes                                                                                                                           |
| **Prescription at purchase** (CP-034)            | CP-019, CP-033                 | Needs the prescription store (CP-019, decision-gated) and a lens taxonomy to check compatibility against                                                                                                                             |
| **Lab operations & warranty** (CP-035)           | CP-034, CP-009                 | A lab job exists only for an order line that carries a verified prescription                                                                                                                                                         |
| **Tax invoice & currency presentation** (CP-036) | CP-032, CP-009                 | Legal invoice fields are only meaningful once tax computation is trustworthy; extends the CP-009 invoice                                                                                                                             |
| **Persian-aware search** (CP-037)                | CP-030, CP-005                 | Extends catalog search; independent of the commerce chain                                                                                                                                                                            |
| **Virtual try-on** (CP-038)                      | CP-020, CP-033                 | Needs a storefront to host it and frame fit attributes from the optical catalog                                                                                                                                                      |
| **Release sync** (CP-039)                        | —                              | A git/release operation over finished branches; gated on owner decisions, not on other phases                                                                                                                                        |
| **AI** (CP-026)                                  | CP-020                         | Recommendation/stylist features need real usage data to be anything but speculative                                                                                                                                                  |

## What can run in parallel today (once CP-015/CP-016 close)

- **CP-017** (notification), **CP-018** (admin), **CP-019** (customer/
  prescription, pending its review gate), **CP-021** (procurement),
  **CP-028** (security hardening completion), and **CP-029** (production
  readiness completion) have **no dependency on each other** — all six
  can be staffed and run concurrently by different work streams once
  CP-016 closes. CP-021 specifically only needs CP-015 (not CP-016) and
  could start even earlier.
- **CP-020** (storefront) is the first phase that genuinely needs two
  prior _tracks_ done (CP-018 admin conventions proven + CP-019 customer
  domain existing) — not parallelizable with either of its own
  prerequisites, but doesn't block CP-017/021/028/029 from proceeding
  alongside it.

## Remediation series (CP-030 – CP-039)

- **Can start now, no external decision:** CP-031, CP-032, CP-037. CP-031 and
  CP-032 touch the same file (`checkout.service.ts`), so merge CP-031 first.
- **Cannot start until an owner / domain decision is made:** CP-033, CP-035,
  CP-036, CP-038, CP-039 (`roadmap.json` status `BLOCKED`; the questions are in
  [`remediation-roadmap.md`](remediation-roadmap.md) §7). CP-034 additionally
  waits on CP-019.
- **CP-039** touches no product code and can run at any time the owner decides;
  the earlier it runs, the less `roadmap.json` drifts from the branches.

## What must be strictly sequential

CP-015 → CP-016 (the two gates, in that order — see
[`../roadmap/critical-path.md`](../roadmap/critical-path.md) for why
Gate 2 should land before or alongside Gate 1's merge, not after).
Both gates are now closed — see `docs/product/phase-016-audit.md`.
CP-012 → CP-013 (013 is a hardening pass on 012's own schema, its
migration literally depends on 012's migration existing first — this
is already true in git history and is preserved exactly by CP-015's
merge order).

## No circular dependencies found

Verified by walking the graph above end to end — every arrow points
strictly toward a later phase, no cycle exists (CP-030 – CP-039 included;
`pnpm roadmap:audit` re-checks this mechanically). This was also verified
architecturally in the Phase 014 audit (no circular NestJS module
imports found in the built modules).
