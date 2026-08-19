# Order Management, Invoice & Fulfillment — Phase 009 scope

Full architectural rationale: [`docs/adr/ADR-009-order-fulfillment.md`](../adr/ADR-009-order-fulfillment.md).
Full endpoint/permission reference: [`docs/api/order.md`](../api/order.md) /
[`docs/security/order-security.md`](../security/order-security.md).
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
  approve/fulfill/ship/complete/refund/invoice.*/shipment.*), two new
  roles, reusing Phase 004's `AuthorizationGuard` wholesale — no new
  authorization mechanism.
- **Audit**: every sensitive mutation (creation, status change,
  cancellation, invoice issuance/void, fulfillment/shipment status change,
  refund initiation) writes a `system.AuditLog` row, reusing Phase 004's
  `AuditLogRepositoryPort` wholesale.
- **Guest and authenticated ownership**, IDOR-protected the same way
  `CheckoutSession`/`PaymentIntent` already are — a mismatched actor gets
  `403`, never a data leak through a `404` that reveals existence.

## Deliberately not built this phase

- **A live courier API integration** — one manual adapter only (ADR-009
  decision 12).
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
