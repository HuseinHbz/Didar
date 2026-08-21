# Returns, refunds & credit notes — product scope (Phase 012)

Full architecture rationale: [`docs/adr/ADR-012-returns-refunds-credit-notes.md`](../adr/ADR-012-returns-refunds-credit-notes.md).
This document is the short "what does this phase actually deliver, and
what does it deliberately not" view, same role every prior phase's own
`docs/product/*.md` plays.

## What this phase delivers

- A customer-facing return request flow, scoped to items an order
  actually delivered, inside a configurable return window
  (`returns.window_days` setting, default 30 days from the item's own
  fulfillment `deliveredAt`).
- An 8-state admin-driven return lifecycle (`REQUESTED -> APPROVED ->
CUSTOMER_SHIPPING -> RECEIVED -> INSPECTING -> APPROVED_FOR_REFUND ->
REFUNDED -> COMPLETED`, with `REJECTED`/`CANCELLED` as terminal exits)
  — see the ADR for the exact graph and reachability rules.
- Server-computed refund amounts, derived entirely from each order
  item's own immutable historical snapshot (never the live catalog,
  never a client-supplied total) — correctly reflecting whatever
  promotion/discount/tax was actually applied at the time of purchase.
- Real inventory restock for physically-accepted returns only —
  triggered exactly once, atomically, the moment a return clears
  inspection — never for a merely-requested or rejected return.
- A minimal, real credit-note lifecycle (`DRAFT -> ISSUED -> APPLIED`,
  `VOID` from either) as an alternative settlement to a cash refund —
  never a rewrite of the original invoice.
- One refund pathway, extended not duplicated: every return-triggered
  refund still goes through the same `RefundService`/`RefundValidator`
  every prior phase's own refund already goes through.

## What this phase deliberately does not build

- **A courier/shipping-label integration for the customer's return
  shipment.** `CUSTOMER_SHIPPING` is a status, not a tracked shipment —
  no new `ShippingProviderPort` consumer this phase.
- **Exchanges/replacements.** A return resolves to a refund or a credit
  note only — there is no "ship a replacement item" resolution type.
- **Inventory restock on order cancellation.** Still deferred, unchanged
  from ADR-011 decision 8 — a structurally different, still-unsolved
  problem (see the ADR's Decision 10 for why the return-restock solution
  in this phase does not also solve it).
- **Automatic retry of a failed/rejected settlement.** A `Refund` that
  ends `FAILED`/`REJECTED` after a return already triggered it needs
  manual admin follow-up — no automatic re-drive loop.
- **A frontend.** `apps/admin`/`apps/storefront`/`apps/pwa`/`apps/mobile`
  remain untouched, same precedent every backend phase has set.
