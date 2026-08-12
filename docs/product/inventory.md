# Inventory, Warehouse & Fulfillment — Phase 006 scope

Full architectural rationale: [`docs/adr/ADR-006-inventory-architecture.md`](../adr/ADR-006-inventory-architecture.md).
Full endpoint/permission reference:
[`docs/api/inventory.md`](../api/inventory.md) /
[`docs/security/inventory-security.md`](../security/inventory-security.md).
Business/product framing this phase implements: `docs/product/blueprint.md`
§23-§27. This document says what's real **today** versus still aspirational
— same convention as `docs/product/catalog.md` and `docs/security/README.md`.

## What this phase is

The production-grade multi-warehouse, multi-store inventory platform: an
append-only stock ledger as the authoritative movement history, location-
granular stock counts, a concurrency-safe reservation engine, warehouse
transfers with a real state machine, manual adjustments and cycle counts
behind approval gates, a configuration-driven allocation engine, and
low-stock detection — all backed by PostgreSQL as the single source of
stock truth (root `CLAUDE.md`'s non-negotiable rule). Redis/BullMQ exist
only to schedule and process background work (reservation expiry, low-stock
notifications) — never as a source of stock state. No client ever mutates
inventory directly; every quantity change goes through the reservation/
adjustment/transfer/count application services, and every one of them
writes an `inventory_ledger` row.

## Domain model at a glance

```
Warehouse (CENTRAL|REGIONAL|STORE|DARK_STORE|QUARANTINE) ──< WarehouseLocation
                                                               (RECEIVING|PICKING|STORAGE|
                                                                QUARANTINE|DAMAGED|RETURNS|STAGING)
       │                                                              │
       └──────────────────────┬───────────────────────────────────────┘
                               │
                        InventoryItem   (productSkuId × warehouseId × locationId,
                               │         cached on_hand/reserved/available/in_transit/
                               │         damaged/quarantined/blocked + version)
                ┌──────────────┼───────────────┬─────────────────┐
       InventoryLedger  InventoryReservation  InventoryThreshold
       (append-only,     (ACTIVE|RELEASED|      (reorder point / safety stock /
        every mutation)   CONVERTED|EXPIRED|     min / max, per SKU+warehouse)
                           CANCELLED, source-
                           tracked + idempotent)

StockTransfer (DRAFT→REQUESTED→APPROVED→PICKING→DISPATCHED→IN_TRANSIT→
               PARTIALLY_RECEIVED|RECEIVED, source warehouse → destination warehouse)
       └──< StockTransferItem  (requested/approved/dispatched/received quantities)

InventoryAdjustment (POSITIVE|NEGATIVE, reason + approver, one-off correction)

StockCount (PLANNED→IN_PROGRESS→COUNTED→UNDER_REVIEW→APPROVED|REJECTED→CLOSED)
       └──< StockCountItem  (expected vs. counted → variance)
```

`productSkuId` throughout is Phase 005's `catalog.product_skus.id` — a
plain, unenforced cross-schema column, same convention as every other
cross-domain reference in this repo (`docs/database/README.md`). See
`docs/database/inventory-erd.md` for the full Mermaid ERD with every column.

## What's real (Phase 006)

- **Warehouse/location management** — five warehouse types, three
  warehouse statuses, seven location types, each warehouse requiring at
  least one location before it can hold stock (ADR-006 decision 1).
- **The ledger** — `InventoryLedger` is append-only; every quantity
  mutation (receipt, sale, reservation, release, transfer leg, adjustment,
  count reconciliation, quarantine move) writes one row carrying
  before/after on-hand and before/after reserved, a movement type, a
  polymorphic `referenceType`/`referenceId`, a reason, an actor, and a
  `correlationId` — a full stock-movement history is reconstructable from
  this table alone, not from the cached counters on `InventoryItem`.
- **The reservation engine** — transactional, row-lock-serialized
  reserve/release/expire/convert, idempotency-key-protected, source-tracked
  (`sourceType`/`sourceId`, deliberately polymorphic — cart, order, POS,
  home-try-on, none of which this phase implements). Expiration is
  processed asynchronously (BullMQ, delayed jobs keyed to
  `expiresAt`), never a synchronous request-time check alone. Proven
  overselling-proof by a real concurrency test: 100 simultaneous
  reservation attempts against 10 available units.
- **Warehouse transfers** — a real 9-state machine
  (`TransferStateMachine`, pure domain service, unit-tested), matching the
  brief's exact status list; dispatch decrements the source, receive
  increments the destination, both writing ledger rows, and a transfer
  can be partially received without losing traceability of what's still
  outstanding.
- **Adjustments & cycle counts** — permission-gated, audited,
  variance-computing (`StockCountVarianceCalculator`); reconciling a count
  writes an `ADJUSTMENT`/`COUNT_ADJUSTMENT` ledger entry per SKU with a
  variance, not a silent overwrite of `on_hand_quantity`.
- **Allocation engine** — configuration-driven (`system.Setting` key
  `inventory.allocation_rules`, ADR-006 decision 7), evaluates candidate
  warehouses against an ordered rule list and returns both the chosen
  warehouse and the explanation of every rule it evaluated.
- **Low-stock detection** — `InventoryThreshold` (reorder point / safety
  stock / min / max, per SKU+warehouse, admin-configurable, never
  hardcoded), evaluated by `LowStockEvaluator` and surfaced both as an
  admin query and an `inventory_low_stock` event/queue job.
- **Barcode lookup** — reuses Phase 005's `catalog.product_skus.barcode`
  (already unique-indexed); no new inventory-schema table needed.
- **RBAC + audit reuse** — every admin/internal write sits behind Phase
  004's `JwtAuthGuard`/`AuthorizationGuard` with a real registered
  permission; every reservation/release/transfer-approve/dispatch/receive/
  adjustment/count-approve writes a `system.AuditLog` row — inventory is
  the second real writer of that table (catalog was the first, Phase 005).
- **Admin + internal + public REST APIs**, all real, all tested — see
  `docs/api/inventory.md` for the full endpoint table.

## What's explicitly not real yet

- **No Next.js admin/POS/storefront pages.** Same precedent Phase 004/005
  set — this phase ships the API surface a future frontend phase (and
  Phase 007's cart/checkout) integrates against, never a UI.
- **No full procurement workflow** — no `PurchaseOrder`/`Supplier`/
  `SupplierInvoice` tables. `PURCHASE_RECEIPT` ledger entries and the
  polymorphic `referenceType`/`referenceId` columns are the readiness seam
  a future Procurement phase writes into (ADR-006 decision 9); nothing
  generates a receipt automatically from a PO today.
- **No full returns workflow** — no `ReturnReceipt`/inspection tables.
  `RETURN_RECEIPT`/`QUARANTINE` movement types and the `QUARANTINE`/
  `DAMAGED`/`RETURNS` location types are real and usable via a manual
  adjustment today; the customer-facing return request/inspection flow
  itself is a future phase.
- **No database-level CHECK constraint** for the never-negative-available
  invariant — enforced transactionally (row lock + domain validation), not
  by the schema; see ADR-006 decision 3 for why, and the mandatory
  concurrency test for the actual proof.
- **No live carrier-rate integration** for the `lowest_shipping_cost`
  allocation rule — a stubbed static-cost-table evaluator this phase, not
  a real shipping-rate API call.
- **No inventory valuation computation** (FIFO/weighted-average costing) —
  the ledger carries the data a future valuation engine would replay; this
  phase doesn't compute a valuation number.
- **No POS UI, no BI/analytics dashboard, no full admin visual redesign.**

Treat anything not explicitly listed above as "not built" — don't assume a
blueprint §23-§27 feature exists just because this file or the blueprint
mentions it.
