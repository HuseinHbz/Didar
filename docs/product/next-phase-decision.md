# Next Phase Decision

**Decision: CP-015 — Integration Reconciliation is the next execution
phase. Nothing else starts before it.**

## Why this, and not any other P0/P1 item

Two P0s exist ([`gap-priority-matrix.md`](gap-priority-matrix.md)):
**P0-1** (CP-012/013 not merged to `develop`) and **P0-2** (CI has no
Redis service, no fail-fast). Both are independent — neither's fix
depends on the other's code changing. Ranked by risk and dependency:

| Factor                      | P0-1 (CP-015)                                                                                                                                                                                                                                                                    | P0-2 (CP-016)                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Risk of leaving open**    | A large financial-integrity subsystem (returns/refunds/settlement) is invisible to the platform's own integration branch — every day this stays open, the gap between "what's built" and "what `develop` says exists" grows if any other work lands on `develop` in the meantime | CI silently cannot validate a required dependency — real, but static; doesn't compound the way an ever-diverging branch does             |
| **Blast radius if delayed** | Grows over time (more commits could land on `develop` that then conflict with the eventual 012/013 merge)                                                                                                                                                                        | Constant (the gap doesn't get worse by waiting, only stays equally dangerous)                                                            |
| **Dependency direction**    | CP-016's own first real CI run (post-merge) is more meaningful if Redis is already fixed — but CP-015 does not _require_ CP-016 to execute the merge itself                                                                                                                      | CP-016 benefits from running after CP-015 so its "first real CI green run" claim is against the fully-merged codebase, not a partial one |
| **Effort/complexity**       | S (git merge only, per `master-roadmap-v2.md`'s own `estimated_complexity`)                                                                                                                                                                                                      | M (touches 5 queue-registration call sites + CI YAML + new rate-limit/observability code)                                                |

**Conclusion:** CP-015 has strictly growing risk from delay and strictly
smaller effort — it goes first. CP-016 should follow immediately after
(not with a long gap), specifically so CP-015's own merge-triggered CI
run already benefits from CP-016's Redis fix rather than being the run
that discovers the gap under real conditions. This matches
[`critical-path.md`](../roadmap/critical-path.md)'s existing sequencing
exactly — this document formalizes that same conclusion under the new
governance process, it does not change it.

## What CP-015 concretely is

Per [`canonical-roadmap.md`](canonical-roadmap.md) and
`master-roadmap-v2.md`'s `P015` definition (content unchanged, only the ID
renamed): merge `12-feature-returns-refunds-credit-notes` into `develop`,
then `13-feature-return-settlement-reconciliation` on top of it, run the
real CI pipeline against the result for the first time, delete the 8
stale duplicate branch refs. No new business logic. No PR unless
explicitly requested (repo convention, unchanged).

## What is explicitly NOT decided here

This document selects **one** next phase. It does not pre-approve CP-016
or any later phase's implementation — each future phase still needs its
own Definition-of-Ready check
([`phase-governance.md`](phase-governance.md)) before it starts, in its
own branch, from its own prompt, per this phase's own instruction
(`P14-16`: implementation happens in a separate branch and prompt, not
here).

## Feature-development prohibition in effect

Per `execution_rules` and task `P14-07`: **no new business feature enters
development until this decision is made and both P0s have an owning
phase.** This document is that decision. CP-015 is now clear to start as
its own phase, in its own branch, on its own prompt — not before, and not
as part of this governance phase.

## Update — CP-030 (2026-10-24): the decision above was executed; the next one

The decision recorded above (CP-015 first, CP-016 right after) was carried out
and both gates are closed (`roadmap.json`: CP-015, CP-016 `VALIDATED`; CP-018 and
CP-021 also merged). The CP-030 review found six new P0 gaps
([`gap-priority-matrix.md`](gap-priority-matrix.md) P0-3 – P0-8), so the same
question — which one first — applies again.

**Decision: CP-031 — Payment/Order/Inventory Consistency is the next execution
phase; CP-032 — Pricing & Tax Integrity follows it.**

| Factor                      | CP-031 (P0-3 – P0-6)                                                                                                          | CP-032 (P0-7, P0-8, P1-10)                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Risk of leaving open**    | Can capture money without creating an order, sell stock that is not allocated, and diverge the refund ledger from the gateway | Silent mispricing and under-collected tax — serious, but each instance is recoverable from the order record |
| **Blast radius if delayed** | Grows with every real payment; the first live payment that straddles the 20-minute checkout hold triggers it                  | Grows with traffic, but a wrong price is visible on the order; a lost order is not                          |
| **External decision**       | None                                                                                                                          | The statutory VAT rate is a configuration value (Q3), not a blocker for the fail-closed code change         |
| **File overlap**            | `cart-checkout/application/checkout.service.ts`, payment intent / refund, order conversion                                    | `checkout.service.ts` (validate / readyForPayment), cart pricing, catalog pricing                           |

CP-031 first because losing an order is strictly worse than mispricing one, and
because the two phases edit the same file — merging in this order avoids conflicts.
CP-037 (Persian-aware search) is also ready but carries no financial risk and can
run in parallel.

**Not decided here:** the BLOCKED phases (CP-033, CP-035, CP-036, CP-038, CP-039).
Each needs an owner or domain decision listed in
[`remediation-roadmap.md`](remediation-roadmap.md) §7 before its Definition of Ready
([`phase-governance.md`](phase-governance.md)) can be met.
