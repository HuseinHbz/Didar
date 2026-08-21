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
  └─▶ CP-016 (platform reliability foundation)
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
```

## Dependency table by domain

| Domain                                      | Depends on             | Because                                                                                                                                                                                                                              |
| ------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Database** (CP-003)                       | CP-001                 | Needs the monorepo/toolchain to exist first                                                                                                                                                                                          |
| **Identity/RBAC** (CP-004)                  | CP-003                 | Every table it needs lives in `identity` schema, created by CP-003                                                                                                                                                                   |
| **Commerce** (CP-007/008/009/012/013)       | CP-004, CP-005, CP-006 | Every commerce route is RBAC-gated or ownership-checked (CP-004); references real SKUs (CP-005) and real stock (CP-006)                                                                                                              |
| **Inventory** (CP-006)                      | CP-003, CP-004, CP-005 | Ledger schema (CP-003), admin RBAC (CP-004), SKU identity reused not duplicated (CP-005)                                                                                                                                             |
| **Finance** (CP-008, CP-009's invoice half) | CP-007                 | Payment/invoice both require a real checkout session to attach to                                                                                                                                                                    |
| **Notification** (CP-017)                   | CP-016                 | Real provider credentials need the secret-handling convention CP-016 doesn't change but the rate-limit/observability minimums should land first so a real SMS integration isn't the first thing exposed to an unbounded request rate |
| **CMS** (CP-023)                            | CP-018                 | Zero value without an admin UI to author content                                                                                                                                                                                     |
| **Analytics** (CP-027)                      | CP-020                 | Meaningless without real customer/order volume, which requires a reachable storefront                                                                                                                                                |
| **Mobile** (CP-022)                         | CP-018, CP-020         | Deliberately sequenced after the same UX is proven once on web, per the roadmap's own "do not build the same product twice in parallel" reasoning                                                                                    |
| **AI** (CP-026)                             | CP-020                 | Recommendation/stylist features need real usage data to be anything but speculative                                                                                                                                                  |

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

## What must be strictly sequential

CP-015 → CP-016 (the two gates, in that order — see
[`../roadmap/critical-path.md`](../roadmap/critical-path.md) for why
Gate 2 should land before or alongside Gate 1's merge, not after).
CP-012 → CP-013 (013 is a hardening pass on 012's own schema, its
migration literally depends on 012's migration existing first — this
is already true in git history and is preserved exactly by CP-015's
merge order).

## No circular dependencies found

Verified by walking the graph above end to end — every arrow points
strictly toward a later phase, no cycle exists. This was also verified
architecturally in the Phase 014 audit (no circular NestJS module
imports found in the built modules).
