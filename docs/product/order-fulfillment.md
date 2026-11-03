# Order Management, Invoice & Fulfillment — Phase 009 scope, hardened in Phase 011

Full architectural rationale: [`docs/adr/ADR-009-order-fulfillment.md`](../adr/ADR-009-order-fulfillment.md)
(Phase 009 — the original build) and
[`docs/adr/ADR-011-order-lifecycle-hardening.md`](../adr/ADR-011-order-lifecycle-hardening.md)
(Phase 011 — hardening, never a rebuild). Full endpoint/permission
reference: [`docs/api/order.md`](../api/order.md)/[`docs/api/fulfillment.md`](../api/fulfillment.md)/
[`docs/api/shipping.md`](../api/shipping.md) /
[`docs/security/order-security.md`](../security/order-security.md)/
[`docs/security/fulfillment-security.md`](../security/fulfillment-security.md).
Business/product framing this phase implements: `docs/product/blueprint.md`
§17, §25, §54. This document says what's real **today** versus still
aspirational — same convention as `docs/product/payment.md`.

## What this phase is

The durable commercial record that survives everything upstream of it: the
moment a `PaymentIntent` verifies, a real `Order` is created deterministically
and idempotently, an `Invoice` is issued with a server-generated number,
and the order enters a fulfillment lifecycle this phase tracks end to end —
allocation, packing, shipping, delivery — without integrating a live
courier API or building a return/RMA workflow.

## Domain model at a glance

```
CheckoutSession(READY_FOR_PAYMENT) → PaymentIntent → PaymentTransaction(VERIFIED)
                                                              │
                                                     OrderConversionService
                                                              │
Order (PENDING_PAYMENT|PAID|PROCESSING|READY_TO_FULFILL|PARTIALLY_FULFILLED|
        FULFILLED|CANCELLED|COMPLETED)
  │  checkoutSessionId UK, paymentIntentId UK — both real FKs, same schema
  │  orderNumber UK, server-generated (Postgres sequence, never client input)
  │  paymentStatus / fulfillmentStatus — cached reads alongside `status`
  ├──< OrderItem (SKU/name/price snapshot — immune to later catalog edits)
  ├──< OrderStatusHistory (append-only, every transition recorded)
  │
  ├──── Invoice (DRAFT|ISSUED|PAID|VOID|CANCELLED)
  │       invoiceNumber UK, server-generated, orderId UK (one per order)
  │       └──< InvoiceItem
  │
  └──< Fulfillment (PENDING|ALLOCATED|PROCESSING|PACKED|READY|SHIPPED|
       │             DELIVERED|CANCELLED) — an order may have many
       ├──< FulfillmentItem (-> OrderItem, quantity ≤ ordered − already fulfilled)
       └──── Shipment (carrier, trackingNumber, status, shippedAt, deliveredAt)
               └──< ShipmentEvent (append-only tracking history)
```

## What's real (Phase 009)

- **Automatic, idempotent order creation** the moment a payment verifies —
  triggered both by the payment callback flow and a reliability-backstop
  sweep (`order_conversion`), never by a client claiming "I paid."
  `checkoutSessionId`/`paymentIntentId` both unique — a duplicate callback
  or a concurrent conversion attempt resolves to the same `Order`, proven
  under real concurrency, not just declared safe.
- **An 8-state order lifecycle** (`OrderStateMachine`, domain-layer, zero
  I/O) — every transition explicit, illegal transitions rejected before a
  controller can even attempt them.
- **Immutable `OrderItem` snapshots** — SKU code, product name, unit price,
  discount, tax all captured at order-creation time; a later catalog price
  or name change never retroactively changes a historical order (blueprint
  §17/§25's own "order ≠ live product" rule).
- **Server-generated order/invoice numbering** — a real Postgres sequence
  per number space, never an application-memory counter, never
  client-supplied, concurrency-safe by construction.
- **Invoice issuance**, automatic and immediate on order creation, totals
  copied from the order's own already-trusted figures (never recomputed,
  never client-supplied); immutable once `ISSUED` except through an
  explicit `VOID`.
- **Partial-fulfillment-aware fulfillment tracking** — an order can be
  fulfilled across multiple `Fulfillment` batches; the domain layer
  structurally prevents fulfilling more of any line than was actually
  ordered, proven under real concurrent fulfillment attempts.
- **A shipment tracking abstraction** (`ShippingProvider` port) with one
  honest manual adapter — no live courier integration exists yet, and this
  phase says so rather than faking one.
- **Cancellation rules that respect physical reality** — an unpaid order
  cancels freely; a paid-but-unfulfilled order's cancellation asks Payment
  (Phase 008) for a refund rather than issuing one itself; a
  partially-fulfilled, fulfilled, or delivered order cannot simply become
  `CANCELLED`.
- **RBAC**: `order.*` permission matrix (read/create/update/cancel/
  approve/fulfill/ship/complete/refund/invoice._/shipment._), two new
  roles, reusing Phase 004's `AuthorizationGuard` wholesale — no new
  authorization mechanism.
- **Audit**: every sensitive mutation (creation, status change,
  cancellation, invoice issuance/void, fulfillment/shipment status change,
  refund initiation) writes a `system.AuditLog` row, reusing Phase 004's
  `AuditLogRepositoryPort` wholesale.
- **Guest and authenticated ownership**, IDOR-protected the same way
  `CheckoutSession`/`PaymentIntent` already are — a mismatched actor gets
  `403`, never a data leak through a `404` that reveals existence.

## What Phase 011 hardened (real gaps found by inspection, not decoration)

- **Two previously-undetected concurrency races closed** — fulfillment-
  status and shipment-status transitions are now row-locked
  (`SELECT ... FOR UPDATE`) the same way `Order.status` already was;
  proven under real concurrent duplicate requests, not assumed safe by
  analogy.
- **Fulfillment creation is now idempotency-key aware** — a retried
  "create this fulfillment" request never creates a second logical
  fulfillment.
- **Order completion is a derived server-side fact**, not an admin
  button — `OrderCompletionValidator` requires every non-cancelled
  `Fulfillment` to actually be `DELIVERED` (not merely quantity-covered)
  and the order's payment state to be settled before `COMPLETED` is
  reachable.
- **Delivery confirmation is its own route, permission, and audit
  action** (`order.shipment.deliver`), separate from generic shipment
  status updates.
- **Tracking numbers are unique and searchable** — a real `@unique`
  constraint plus an admin lookup route, still never client-forged (still
  admin-entered only).
- **Real, database-backed admin order search/filtering** — payment
  state, fulfillment state, date range, customer — replacing the
  previous status-only filter.
- **The order read surface now exposes its Phase 010 promotion
  snapshot** — a gap Phase 010's own final report flagged explicitly.

See ADR-011 for the full rationale, including the one gap Phase 011
deliberately did **not** close (see "Deliberately not built this phase"
below).

## Deliberately not built this phase

- **A live courier API integration** — one manual adapter only (ADR-009
  decision 12).
- **Inventory restock on order cancellation** — explicitly re-evaluated
  in Phase 011 (the brief's own explicit prompt) and deliberately still
  deferred: the current schema/reservation lineage cannot trace, at the
  granularity a correct restock needs, which specific warehouse/location
  absorbed a given order line's decrement — see ADR-011 decision 8 for
  the full reasoning. Same no-automatic-restock precedent
  `docs/product/payment.md` already set for refunds, not a new omission.
- **Post-delivery returns/RMA/dispute handling** beyond what Phase 008's
  refund/reconciliation already surfaces.
- **Per-line-item partial cancellation** — only whole-order cancellation.
- **A credit-note/re-issue mechanic** for a voided invoice.
- **An admin endpoint that creates an `Order` directly from a request
  body**, bypassing checkout/payment — every order, including
  admin/POS-sourced ones, still flows through a real checkout+payment
  chain (ADR-009 decision 11). A true offline/cash-settled POS order path
  is a gap for a future phase.
- **Loyalty/wallet settlement** on order completion.
- **A frontend** — `apps/admin`/`apps/storefront`/`apps/pwa`/`apps/mobile`
  remain untouched, same precedent every backend phase has set.

## What CP-031 changed for the business (stock behind every paid order)

Rationale: [`docs/adr/ADR-031-payment-order-consistency.md`](../adr/ADR-031-payment-order-consistency.md).
Order managers should read this section before go-live.

- **A captured payment always yields exactly one order, whether or not the customer comes back to
  the site.** A background sweep now creates the order from any verified payment that has none.
- **A paid order always has stock taken out of the warehouse, or a visible exception.** On creation
  each line's stock is sold from the checkout's reservation or, if that was released, taken afresh.
  If the stock is genuinely gone the order is still created and `PAID` (the customer has paid) and a
  **blocking exception** appears in `GET /admin/order-exceptions`. While it is open the order cannot
  be approved (`409`).
- **Two ways to clear an exception, no third:** receive stock and call
  `POST /admin/order-exceptions/:id/retry-allocation` (`409` while still short), or cancel the
  order (which requests the refund). There is no "approve anyway". Permissions:
  `order.exception.read` to watch the queue, `order.exception.resolve` to act — granted to `admin`
  and `order_manager`, **not** to `fulfillment_clerk`.
- **Someone has to watch that queue.** A queue nobody reads is the same failure as a swallowed log
  line; there is no notification yet when an exception opens (not scoped to any phase — raise it
  with the owner if a Telegram/SMS alert is wanted).
- **Cancelling an order** refunds only what was paid and not yet refunded. If the refund request
  itself fails the order is still cancelled, the failure is logged and audited, and finance must
  settle it with `POST /admin/orders/:id/refund` — it is not retried automatically (P1-18, CP-040).
- Partial refunds of an order are `REJECTED` and settled by hand while ZarinPal is the only gateway —
  see `docs/product/payment.md`.

**Still not built (owned by CP-040):** a coupon's usage slot released when a checkout expired is not
re-acquired when the order is created from a late payment (P1-17); a SKU whose stock is spread over
several locations of one warehouse can be reported short even though the total suffices (P2-17,
which shows up as a false `STOCK_SHORTFALL` — the safe direction). Inventory restock on
cancellation remains deferred (ADR-011 decision 8).
