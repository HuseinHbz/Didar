# Order ERD (Phase 009 — full detail)

Source of truth for the order/fulfillment/shipment portion of the
`commerce` schema and the invoice portion of the `finance` schema —
every column, every FK/UK, and the design rationale behind the
non-obvious choices. The `## commerce`/`## finance` sections in
[`erd.md`](./erd.md) are an intentionally abbreviated summary that links
here; this document is the one to update whenever this portion of
`packages/database/prisma/schema.prisma` changes.

Design rationale for the choices below: [`docs/adr/ADR-009-order-fulfillment.md`](../adr/ADR-009-order-fulfillment.md).
Module-level detail (what reads/writes these tables and how):
[`services/api/src/modules/order/README.md`](../../services/api/src/modules/order/README.md).

This migration **drops** Phase 003's placeholder `Order`/`OrderItem`/
`OrderStatusHistory`/`Invoice`/`InvoiceLine` (a shared placeholder
`OrderStatus` enum, no real payment/fulfillment link) and replaces them
entirely with the subtree below — the same "placeholder identified,
replaced with the real thing" precedent every prior phase set. `down.sql`
restores the exact pre-migration placeholder shape, verified via a full
up → down → up round trip.

## Enums

```
OrderSource             STOREFRONT | ADMIN | POS
OrderStatus             PENDING_PAYMENT | PAID | PROCESSING |
                          READY_TO_FULFILL | PARTIALLY_FULFILLED |
                          FULFILLED | CANCELLED | COMPLETED
OrderPaymentStatus       UNPAID | PARTIALLY_PAID | PAID |
                          PARTIALLY_REFUNDED | REFUNDED
OrderFulfillmentStatus   UNFULFILLED | PARTIALLY_FULFILLED | FULFILLED
FulfillmentStatus        PENDING | ALLOCATED | PROCESSING | PACKED |
                          READY | SHIPPED | DELIVERED | CANCELLED
ShipmentStatus           PENDING | IN_TRANSIT | DELIVERED | FAILED |
                          CANCELLED
InvoiceStatus            DRAFT | ISSUED | PAID | VOID | CANCELLED
```

`OrderPaymentStatus`/`OrderFulfillmentStatus` are cached reads alongside
`OrderStatus`, always derived from real data (`PaymentTransaction`/
`Refund` sums, `FulfillmentItem` sums respectively) — never
independently authoritative. Each enum's legal transition graph is
enforced by its own domain-layer state machine (`OrderStateMachine`,
`FulfillmentStateMachine`, `ShipmentStateMachine`, `InvoiceStateMachine`)
before any row is written — see each service's own doc comment for the
exact graph.

## Diagram

```mermaid
erDiagram
    checkout_sessions ||--o| orders : converts_to
    payment_intents ||--o| orders : pays_for
    orders ||--o{ order_items : has
    orders ||--o{ order_status_history : has
    orders ||--o{ fulfillments : has
    orders ||--o| invoices : has
    order_items ||--o{ fulfillment_items : "fulfilled by"
    fulfillments ||--o{ fulfillment_items : has
    fulfillments ||--o| shipments : has
    shipments ||--o{ shipment_events : has
    invoices ||--o{ invoice_items : has

    orders {
        uuid id PK
        string order_number UK "ORD-YYYYMMDD-NNNNNN, commerce.order_number_seq"
        uuid checkout_session_id UK "-> commerce.checkout_sessions.id, real FK"
        uuid payment_intent_id UK "-> commerce.payment_intents.id, real FK"
        uuid customer_id "nullable — guest order"
        string guest_token "nullable"
        enum source "STOREFRONT|ADMIN|POS"
        enum status "8-state lifecycle, default PENDING_PAYMENT"
        enum payment_status "cached, default UNPAID"
        enum fulfillment_status "cached, default UNFULFILLED"
        bigint subtotal
        bigint discount_total
        bigint tax_total
        bigint shipping_total
        bigint grand_total
        bigint paid_total "default 0"
        bigint refunded_total "default 0"
        json shipping_address_snapshot
        json billing_address_snapshot "nullable"
        timestamp placed_at
        timestamp cancelled_at "nullable"
        timestamp completed_at "nullable"
    }
    order_items {
        uuid id PK
        uuid order_id FK
        uuid product_sku_id "nullable — the live SKU may later be deleted"
        string sku_snapshot
        string name_snapshot
        bigint unit_price_snapshot
        int quantity
        bigint discount_amount "default 0"
        bigint tax_amount "default 0"
        bigint line_total
    }
    order_status_history {
        uuid id PK
        uuid order_id FK
        enum from_status "nullable — null on first row"
        enum to_status
        uuid changed_by "nullable — null means system-generated"
        string note "nullable"
    }
    fulfillments {
        uuid id PK
        uuid order_id FK
        enum status "8-state lifecycle, default PENDING"
        uuid warehouse_id "nullable, -> inventory.warehouses.id, unenforced"
        timestamp packed_at "nullable"
        timestamp shipped_at "nullable"
        timestamp delivered_at "nullable"
        timestamp cancelled_at "nullable"
    }
    fulfillment_items {
        uuid id PK
        uuid fulfillment_id FK
        uuid order_item_id FK
        int quantity
    }
    shipments {
        uuid id PK
        uuid fulfillment_id UK "one shipment per fulfillment"
        string carrier "nullable"
        string tracking_number "nullable"
        enum status "PENDING|IN_TRANSIT|DELIVERED|FAILED|CANCELLED"
        timestamp shipped_at "nullable"
        timestamp delivered_at "nullable"
    }
    shipment_events {
        uuid id PK
        uuid shipment_id FK
        enum status
        string location "nullable"
        json details "nullable"
        string source "default MANUAL_ADMIN — plain string, no live courier webhook yet"
        timestamp occurred_at
    }
    invoices {
        uuid id PK
        string invoice_number UK "INV-YYYYMMDD-NNNNNN, finance.invoice_number_seq"
        uuid order_id UK "-> commerce.orders.id, unenforced (finance schema)"
        uuid customer_id "nullable, -> customer.customers.id, unenforced"
        enum status "DRAFT|ISSUED|PAID|VOID|CANCELLED, default DRAFT"
        bigint subtotal
        bigint discount_total "default 0"
        bigint tax_total "default 0"
        bigint shipping_total "default 0"
        bigint grand_total
        timestamp issued_at "nullable"
        timestamp voided_at "nullable"
        string pdf_url "nullable — no PDF generation this phase"
    }
    invoice_items {
        uuid id PK
        uuid invoice_id FK
        string description
        int quantity
        bigint unit_price
        bigint line_total
    }
```

## Key design decisions

**`orders.checkout_session_id`/`orders.payment_intent_id` are real,
enforced, `@unique` FKs — both same-schema, unlike every prior module's
cross-schema pointers.** An `Order` is created from exactly one checkout
and exactly one payment intent, never more than once each; this is the
idempotency anchor `OrderConversionService.convertFromCheckout()`'s own
P2002-catch-and-reread safety relies on (ADR-009 decision 4). Every
order therefore always traces back to a real, verified payment — there
is no schema-level path to a manually-created, unpaid order.

**Three cached fields alongside one authoritative state machine.**
`status`/`payment_status`/`fulfillment_status` — the same "cache columns

- append-only/authoritative source" split `CheckoutSession` and
  `InventoryItem` already established in prior phases (ADR-009 decision 3).
  `payment_status`/`fulfillment_status` are never independently written by
  a client; both are always re-derived from `PaymentTransaction`/`Refund`
  sums or `FulfillmentItem` sums respectively.

**`order_items` snapshots everything a receipt needs.** `sku_snapshot`/
`name_snapshot`/`unit_price_snapshot` carry the historical truth
regardless of what happens to the live `ProductSku` afterward
(`product_sku_id` is nullable for exactly this reason) — an `Order` is
not a live view of the catalog (ADR-009 decision 1).

**`order_status_history` is append-only, no unique key on
`(order_id, to_status)`.** Every transition is its own row, `changed_by`
null meaning system-generated — same convention `system.AuditLog` uses.
Concurrency-safety against duplicate rows from a genuine race is enforced
at the repository layer (`SELECT ... FOR UPDATE` before deciding whether
to write), not by a database constraint — see the module README.

**`fulfillment_items.order_item_id` references a concrete `OrderItem`,
never a bare SKU string.** The over-fulfillment invariant (every
`FulfillmentItem.quantity` summed across every non-`CANCELLED`
`Fulfillment` for the same `order_item_id` never exceeds
`OrderItem.quantity`) is enforced in the domain/infrastructure layer via
a row-locked re-sum at write time (reusing `mutateInventoryItem`'s own
`SELECT ... FOR UPDATE` technique from Phase 006), not a database CHECK
constraint — Postgres has no cross-row aggregate constraint mechanism.

**`shipments.fulfillment_id` is `@unique` — one shipment per
fulfillment, not per order.** A partially-fulfilled order can have
multiple fulfillments, each shipping independently (ADR-009 decision
12). `shipment_events.source` is a plain string, not an enum — no live
courier webhook exists yet to give it a real closed vocabulary; always
`"MANUAL_ADMIN"` or `"SYSTEM"` this phase, deliberately not over-modeled
ahead of a real integration.

**`invoices.order_id` is `@unique` — at most one invoice per order, no
credit-note/re-issue mechanic this phase.** A correction is a `VOID`
(reachable from `ISSUED`/`PAID`) plus manual admin follow-up, not an
automatic re-issue (ADR-009 decision 7). `pdf_url` is nullable and
unused this phase — no PDF rendering pipeline exists yet.

**Two real Postgres sequences, not application-memory counters.**
`commerce.order_number_seq`/`finance.invoice_number_seq` — `nextval()` is
atomic at the database level, the concurrency-safety guarantee an
application-memory counter cannot honestly provide (ADR-009 decision 6).
Not expressible in `schema.prisma` (Prisma has no native sequence
primitive); hand-added via raw SQL at the end of the migration.

## Cross-schema references (unenforced, same convention as every other module)

`fulfillments.warehouse_id` references `inventory.warehouses.id`.
`orders.customer_id`/`invoices.customer_id` reference
`customer.customers.id`. `order_status_history.changed_by` references
`identity.users.id`. `invoices.order_id` itself is a cross-schema
pointer (`finance` -> `commerce`) despite being the one truly `@unique`
1:1 relationship in this subtree — Prisma/Postgres FKs cannot cross
schemas here any more than they can cross the other module boundaries in
this database, same rationale `docs/database/README.md`'s "Cross-schema
references are intentionally unenforced" section gives for every other
cross-schema pointer in this repo.

## Migration

`packages/database/prisma/migrations/20260814000000_order_fulfillment_foundation/`
— hand-authored, with a `down.sql` verified via a full up → down → up
round trip against real Postgres (`prisma migrate diff` confirmed zero
drift at every step; `catalog.products`/`inventory.warehouses`/
`commerce.carts`/`commerce.checkout_sessions`/`identity.users`/
`commerce.payment_intents`/`commerce.payment_transactions` row counts
confirmed intact throughout). The rollback restores the exact Phase 003
placeholder `orders`/`invoices` shape (0 rows either way — nothing to
carry back), so the round trip is reproducible regardless of how many
times it repeats.
