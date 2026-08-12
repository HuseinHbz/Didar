# ADR-006 — Inventory, Warehouse & Fulfillment-Readiness Architecture

- **Status**: Accepted
- **Phase**: 006 (`feature/inventory-warehouse`)
- **Depends on**: ADR-005 (catalog/SKU model), Phase 004 identity/RBAC

## Context

Phase 003 shipped a placeholder `inventory` schema — one `Warehouse`, one
`InventoryItem` (on-hand/reserved only, no location granularity), one
`InventoryTransaction` (a thin ledger), one `StockReservation` (no source
tracking, no idempotency). It was enough to prove Product/Cart/Order could
reference a stock row; it was never meant to survive contact with a real
multi-warehouse, multi-store fulfillment operation.

Phase 006's brief asks for the real thing: multiple warehouse/store models,
location-level stock, an append-only ledger that explains every quantity
change, a concurrency-safe reservation engine, warehouse-to-warehouse
transfers with a real state machine, manual adjustments and cycle counts
with approval gates, a configuration-driven allocation engine, low-stock
detection, and procurement/returns _readiness_ (not full workflows) — all
while treating PostgreSQL as the one authoritative source of stock truth
and reusing Phase 004's RBAC/audit machinery rather than inventing a new one.

## Decision 1 — Location-granular `InventoryItem`, uniquely keyed on (SKU, warehouse, location)

Phase 003's `InventoryItem` was keyed on `(warehouseId, productSkuId)` —
warehouse-level only. Real WMS operations need bin/location granularity
(a `RECEIVING` dock vs. a `PICKING` shelf vs. a `QUARANTINE` cage are
different physical counts, not the same row). `InventoryItem` is now keyed
on `(productSkuId, warehouseId, locationId)`, and every `Warehouse` must
have at least one `WarehouseLocation` before it can hold stock — the seed
creates a default `STORAGE` location per warehouse, and `WarehousesService`
does the same for every warehouse an admin creates. This trades a small
amount of extra ceremony (you can't add stock to a warehouse with zero
locations) for a model that doesn't need a special-cased "warehouse-level
aggregate row" concept once real location tracking is added later.

## Decision 2 — Quantity buckets are a maintained cache; `inventory_ledger` is the reason why

Same principle Phase 003 already established for `InventoryTransaction`
(`docs/database/README.md` convention 8 — "stock is a ledger, not a mutable
counter") and now applied with more buckets. `InventoryItem` carries
`onHandQuantity`/`reservedQuantity`/`availableQuantity`/`inTransitQuantity`/
`damagedQuantity`/`quarantinedQuantity`/`blockedQuantity` as **cached,
maintained columns** — read-optimized, always written inside the same
database transaction as the `InventoryLedger` row that explains the change.
`availableQuantity` is stored (the brief's own `inventory_item.requirements`
lists it as a field, not merely derivable) but is never the primary
authority: `available = on_hand - reserved - damaged - quarantined -
blocked` (the brief's own formula) is recomputed and asserted by
`AvailableQuantityCalculator` (pure domain service) on every write, not
trusted as already-correct input. `InventoryLedger` is append-only,
never updated or deleted, and is what a full stock-history reconstruction
replays — the cached columns are a read-path optimization, not a second
source of truth.

## Decision 3 — No database CHECK constraint for "never negative"; enforced by the transaction, not the schema

Investigated first: Prisma 6.19 (this repo's version) has no native
`@@check(...)` schema attribute — confirmed by trying it against a scratch
model (`P1012` — "not a valid field or attribute definition"). A raw
`ALTER TABLE ... ADD CONSTRAINT ... CHECK` applied outside Prisma's own
migration model is technically possible but risks exactly the kind of
schema/migration-history drift `docs/database/README.md`'s "zero drift"
verification is designed to catch, since Prisma would have no record of
owning it. Given that trade-off, the negative-quantity invariant is
enforced where it actually matters — inside the transaction, before the
write — not by a constraint the ORM doesn't know about:

- Every mutation that touches `InventoryItem` quantities runs inside a
  Prisma `$transaction`, `SELECT ... FOR UPDATE`-locking the row first
  (see Decision 4).
- The domain layer (`ReservationRules`/`AdjustmentValidator`/
  `AvailableQuantityCalculator`) computes the resulting quantities from the
  locked row's _current_ values and throws (`InsufficientStockError`, a
  plain `Error` subclass mapped to 409 by
  `InventoryDomainExceptionFilter`, same pattern as ADR-005's
  `CatalogDomainExceptionFilter`) before any write happens if any bucket
  — most importantly `availableQuantity` — would go negative.
- The mandatory concurrency test (100 simultaneous reservation attempts
  against 10 available units) is the actual proof this holds, not a code
  read-through. See `services/api/src/modules/inventory/README.md`#testing.

If a future phase wants defense-in-depth at the database layer too, adding
the CHECK constraint via a dedicated, clearly-labeled migration (accepting
the Prisma-unmanaged-constraint trade-off explicitly) is a small, isolated
follow-up — not blocking this phase.

## Decision 4 — Concurrency: row-level pessimistic lock + a `version` column, not optimistic-only

`SELECT ... FOR UPDATE` (via `prisma.$transaction` + `$queryRaw`) on the
target `InventoryItem` row is the actual concurrency-safety mechanism —
it serializes every conflicting reserve/release/adjust/receive/dispatch
against that exact SKU+warehouse+location, so two concurrent requests for
the last unit of stock cannot both read "1 available" and both succeed.
`version` (an `Int`, incremented on every write) is carried too, per the
brief's own "optimistic locking/version columns where useful" — it isn't
the primary concurrency mechanism here (the row lock already prevents the
race), but it gives every `InventoryLedger` row a cheap, queryable
"which write generation was this" marker, and is what a future
read-then-compare-and-swap caller (e.g. a bulk import that reads state
outside a transaction) would use instead of a fresh lock.

## Decision 5 — Reservation source is polymorphic (`sourceType`/`sourceId`), not an FK — and always carries an idempotency key

`InventoryReservation.sourceType`/`sourceId` follow the same deliberately
unenforced, polymorphic-reference pattern `InventoryTransaction.reference`
already used in Phase 003 (cart, order, POS sale, home-try-on — none of
which exist as a real domain module yet except `commerce.Cart`, which
Phase 006 still must not implement checkout logic for). A real FK would
force this table to pick one referenced schema, which is exactly backwards
for a reservation engine three future modules (cart, POS, home-try-on) all
need to call into. `idempotencyKey` is a required, unique column —
`POST /internal/inventory/reservations` upserts on it rather than blindly
inserting, so a client retry (timeout, double-tap) after an already-
succeeded reservation returns the original result instead of double-
reserving.

## Decision 6 — `InventoryThreshold` is its own table, decoupled from location

Low-stock rules are per **SKU + warehouse** (the brief's own wording —
"Thresholds may vary per SKU and warehouse", not per location). Coupling
reorder point/safety stock/min/max to a specific `WarehouseLocation` would
force an admin to pick an arbitrary location to hold a warehouse-wide
threshold. `InventoryThreshold` is keyed `(productSkuId, warehouseId)`
instead — one row answers "is this SKU low at this warehouse" regardless of
how many locations within it hold stock; `LowStockEvaluator` (domain
layer) sums `InventoryItem.availableQuantity` across a warehouse's
locations for that SKU and compares against the threshold row.

## Decision 7 — Allocation rules live in `system.Setting`, not a new table

The brief is explicit: "Rules must be configuration-driven... do not
hardcode warehouse selection." A new `AllocationRule` table was considered
and rejected as over-building for what this phase actually needs — the
existing `system.Setting` (`key`/`value: Json` — already the project's
generic admin-configurable-value store, blueprint §87) holds one row,
key `inventory.allocation_rules`, whose `value` is an ordered array of
`{type, params, priority}` (`nearest_warehouse` |
`preferred_store` | `lowest_shipping_cost` | `highest_available_quantity`
| `priority_warehouse` | `customer_selected_store` |
`click_and_collect`). `AllocationEngine` (pure domain service) evaluates
them in priority order against a snapshot of candidate warehouses' stock
and returns both a winner **and** the ordered list of rules it evaluated
(`AllocationResult.explanation`) — "Allocation result must be explainable"
from the brief is a returned value, not a log line someone has to go dig
for. Swapping which rule wins, or adding a new rule type's parameters, is
an admin `PATCH` on that `Setting` row, not a code change — though adding
an entirely new rule _type_ (a new `AllocationRuleType` the evaluator
knows how to interpret) is still a code change, same trade-off ADR-005
decision 4 made for `CollectionRules`.

## Decision 8 — BullMQ queues run in-process inside `services/api`, not `services/worker`

`services/worker`'s own `package.json` describes it as the _generic_
background-job worker (image processing, PDF invoices, search indexing,
analytics — cross-cutting jobs with no tight domain coupling). Inventory's
three required queues are the opposite: `reservation_expiration` must call
back into the exact same `ReservationService.release()` path a controller
uses (same domain validation, same ledger-writing transaction, same
`InventoryItem` row lock), and `low_stock_notification`/
`inventory_event_processing` read state that only the inventory module's
own repositories know how to query correctly. Routing these through
`services/worker` would mean either (a) duplicating reservation/ledger
domain logic in a second service, or (b) `services/worker` making HTTP
calls back into `services/api`'s internal API — both worse than the third
option taken here: `services/api` registers `BullModule.forRootAsync`
itself (same `REDIS_URL`-based connection config `services/worker`
already uses) and hosts the `@Processor()`s for these three queues
directly inside `modules/inventory/infrastructure/queues/`, in the same
NestJS DI container as the services they call. `services/worker` remains
exactly what it already was — this phase adds nothing to it.

## Decision 9 — Procurement/returns readiness is a polymorphic reference, not new tables

The brief explicitly lists `purchase_order`/`goods_receipt`/`supplier`/
`supplier_invoice` (procurement) and `return_receipt`/`inspection`/
`restock`/`quarantine`/`damaged_return` (returns) as "prepare for, do not
implement." Building placeholder tables for entities with no real workflow
behind them yet would be exactly the kind of premature scaffolding this
project's own established pattern (ADR-005's "don't over-build") argues
against. The actual readiness this phase provides: `InventoryLedger`
already has `PURCHASE_RECEIPT`/`RETURN_RECEIPT`/`QUARANTINE`/
`RELEASE_FROM_QUARANTINE` as real, usable `InventoryMovementType` values,
and `referenceType`/`referenceId` are free-form/polymorphic — so a future
Procurement phase's `GoodsReceipt.id` or a future Returns phase's
`ReturnReceipt.id` can be written into an `InventoryLedger` row's
`referenceId` the day those tables exist, with zero schema change to
`inventory`. `QUARANTINED` as an `InventoryItem` quantity bucket and
`QUARANTINE`/`DAMAGED`/`RETURNS` as real `WarehouseLocation` types are
already real and usable today (an admin adjustment can move stock into
quarantine right now via `POST /admin/inventory/adjustments`) — only the
supplier/PO-side workflow that would _feed_ a `PURCHASE_RECEIPT` ledger
entry automatically is deferred.

## Decision 10 — Barcode lookup reuses `catalog.product_skus.barcode`, no new table

`ProductSku.barcode` (Phase 005, already `@unique`) is the barcode. Fast
lookup is `GET /internal/inventory/availability/:skuId`-shaped, resolving
`barcode → skuId` via the existing unique index — no new inventory-schema
table needed for "barcode readiness"; the readiness was already built in
Phase 005 and this phase's barcode endpoint is a thin read on top of it.

## Decision 11 — RBAC/audit reuse (same shape as ADR-005 decision 6)

Every admin/internal mutation sits behind Phase 004's `JwtAuthGuard`/
`AuthorizationGuard`/`@RequirePermission`/`@RequireModule`. Thirteen new
`inventory.*` permissions, four new roles
(`inventory_manager`/`warehouse_operator`/`store_manager`/
`inventory_auditor`). Every reservation/release/transfer-approve/transfer-
dispatch/transfer-receive/adjustment/count-approve writes a
`system.AuditLog` row — inventory becomes the second real writer of that
table (catalog was the first, Phase 005).

## Deferred (explicitly, per the brief's own scope list)

- Full procurement workflow (purchase orders, suppliers, goods receipt UI).
- Full returns workflow (inspection, restock decisioning UI).
- POS UI, BI/analytics dashboards, full admin visual redesign.
- A database-level CHECK constraint for the never-negative invariant
  (Decision 3) — enforced transactionally instead.
- Real-time carrier/shipping-cost integration for the `lowest_shipping_cost`
  allocation rule — this phase implements the rule shape and a stubbed
  static-cost-table evaluator, not a live carrier-rate API call.
- Multi-currency/valuation costing (FIFO/weighted-average inventory
  valuation) — `inventory_valuation readiness` in the brief means the
  ledger has the data (`quantity`, movement type, timestamps) a future
  valuation engine would replay, not that valuation is computed here.

## Consequences

`inventory` becomes the third full clean-architecture module in
`services/api` (after `identity`, `catalog`), and the first to require
BullMQ/Redis as a hard runtime dependency for `services/api` itself (not
just `services/worker`). Every future module that sells something
(`cart`/`checkout`/`order`/`pos`) integrates against this phase's stable
seam: `GET /internal/inventory/availability/:skuId`,
`POST /internal/inventory/reservations` (+`/release`, `/convert`), and the
`inventory_*` event set — never against `InventoryItem` directly.
