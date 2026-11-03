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

## Update — CP-031 (2026-11-03): implemented; the next decision is CP-041, then CP-032

CP-031 is implemented on `31-feature-payment-order-consistency` (draft PR, stacked on
the CP-030 PR) and closes P0-3, P0-4, P0-5, P0-6 and P2-16 — each reproduced first on
the `develop` source (15 failing / 5 passing controls) and then proven closed on real
PostgreSQL ([`phase-031-audit.md`](phase-031-audit.md),
[`ADR-031`](../adr/ADR-031-payment-order-consistency.md)). The same question —
which one first — applies again, and the answer changes because of something CP-031
itself had to establish.

**Decision: CP-041 — CI Gate Restoration (P0-9) is the next execution phase; CP-032
— Pricing & Tax Integrity follows it.**

| Factor                  | CP-041 (P0-9)                                                                                                                                          | CP-032 (P0-7, P0-8, P1-10)                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **What is wrong today** | `lint` red on every run since 2026-08-12, `e2e` intermittently failing, `security` (`pnpm audit --audit-level high`) red on the advisories in P0-9     | Silent mispricing and under-collected tax on a placed order                                               |
| **Why it ranks first**  | Definition of Done item 3 ("CI green") cannot be met by _any_ phase until it is repaired; CP-031 itself is IMPLEMENTED, not VALIDATED, for this reason | Serious, but each instance is visible on the order and recoverable                                        |
| **External decision**   | Only the merge policy while the gate is red and the advisory-upgrade policy (Q10) — neither blocks the lint and flaky-test work                        | The statutory VAT rate is configuration finance must confirm (Q3), not a blocker for the fail-closed code |
| **Effort**              | Small, mostly mechanical (lint rules in `seed.ts`, one flaky e2e, dependency bumps)                                                                    | Medium — pricing pipeline plus a tax model                                                                |
| **File overlap**        | Tooling, lockfile, `seed.ts`; no product code                                                                                                          | `checkout.service.ts`, cart pricing, catalog pricing — also edited by CP-031                              |

CP-041 first because a gate that is red for reasons unrelated to the change cannot
distinguish a regression from the baseline, so every later phase would be merged on
trust rather than on evidence — the failure mode the governance process exists to
prevent. It touches no product code, so it does not conflict with CP-031 or CP-032.
CP-032 second, branched from CP-031 (or after CP-031 merges), because both edit
`checkout.service.ts`. CP-037 (Persian-aware search) is still ready and independent.

**Not decided here:** the BLOCKED phases (CP-033, CP-035, CP-036, CP-038, CP-039) and
CP-040 (payment recovery and refund settlement — it is blocked on Q9, who settles a
rejected partial refund by hand and what record proves it, and it owns the residual
gaps P1-16 – P1-20 and P2-17 that CP-031 documented but deliberately did not widen
its scope to cover).

**What changes for operations the moment CP-031 is deployed:** with ZarinPal as the
only gateway every partial refund is `REJECTED` (it cannot express a partial reversal)
and is settled manually — see
[`../operations/refund-manual-settlement-runbook.md`](../operations/refund-manual-settlement-runbook.md);
and `POST /admin/payments/refunds/:id/process` on a refund that is already
`PROCESSING` now returns 409 instead of sending it to the gateway a second time.
