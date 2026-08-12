# Inventory ERD (Phase 006 — full detail)

Source of truth for the `inventory` schema, every column, every FK/UK, and
the design rationale behind the non-obvious choices. The `## inventory`
section in [`erd.md`](./erd.md) is an intentionally abbreviated summary that
links here; this document is the one to update whenever `inventory`'s
section of `packages/database/prisma/schema.prisma` changes.

Design rationale for the choices below: [`docs/adr/ADR-006-inventory-architecture.md`](../adr/ADR-006-inventory-architecture.md).
Module-level detail (what reads/writes these tables and how):
[`services/api/src/modules/inventory/README.md`](../../services/api/src/modules/inventory/README.md).

This schema replaces Phase 003's placeholder shape (`InventoryTransaction`,
`StockReservation`, `InventoryItem` keyed on `productVariantId`) — see the
migration's own header comment
(`packages/database/prisma/migrations/20260812180528_inventory_warehouse_ledger_foundation/migration.sql`)
for the exact old→new data-preserving mapping.

## Enums

```
WarehouseType                CENTRAL | REGIONAL | STORE | DARK_STORE | QUARANTINE
WarehouseStatus               ACTIVE | INACTIVE | CLOSED
LocationType                   RECEIVING | PICKING | STORAGE | QUARANTINE |
                                DAMAGED | RETURNS | STAGING
InventoryMovementType          PURCHASE_RECEIPT | SALE | RESERVATION |
                                RESERVATION_RELEASE | TRANSFER_OUT |
                                TRANSFER_IN | RETURN_RECEIPT | DAMAGE |
                                ADJUSTMENT | COUNT_ADJUSTMENT | QUARANTINE |
                                RELEASE_FROM_QUARANTINE | MANUAL_CORRECTION
InventoryReservationStatus     ACTIVE | RELEASED | CONVERTED | EXPIRED | CANCELLED
StockTransferStatus            DRAFT | REQUESTED | APPROVED | PICKING |
                                DISPATCHED | IN_TRANSIT | PARTIALLY_RECEIVED |
                                RECEIVED | CANCELLED
InventoryAdjustmentType        POSITIVE | NEGATIVE
StockCountStatus                PLANNED | IN_PROGRESS | COUNTED |
                                UNDER_REVIEW | APPROVED | REJECTED | CLOSED
```

`InventoryMovementType` is the brief's exact required 13-value vocabulary —
it replaces Phase 003's smaller `InventoryTransactionType` placeholder
(`PURCHASE`/`RELEASE`/`RETURN`/...). `StockTransferStatus`'s 9 states are
enforced by `TransferStateMachine` (domain layer) before any row is written
— see that service's own doc comment for the exact transition graph.

## Diagram

```mermaid
erDiagram
    warehouses ||--o{ warehouse_locations : has
    warehouses ||--o{ inventory_items : stocks
    warehouses ||--o{ inventory_thresholds : has
    warehouses ||--o{ stock_transfers : "source of"
    warehouses ||--o{ stock_transfers : "destination of"
    warehouses ||--o{ inventory_adjustments : has
    warehouses ||--o{ stock_counts : has
    warehouse_locations ||--o{ inventory_items : holds
    warehouse_locations ||--o{ inventory_ledger : "recorded at"
    warehouse_locations ||--o{ inventory_adjustments : "recorded at"
    warehouse_locations ||--o{ stock_counts : "scoped to (nullable)"
    inventory_items ||--o{ inventory_ledger : has
    inventory_items ||--o{ inventory_reservations : has
    stock_transfers ||--o{ stock_transfer_items : contains
    stock_counts ||--o{ stock_count_items : contains

    warehouses {
        uuid id PK
        string code UK
        string name
        enum type "CENTRAL|REGIONAL|STORE|DARK_STORE|QUARANTINE"
        enum status "ACTIVE|INACTIVE|CLOSED"
        string address "nullable"
        string timezone "default Asia/Tehran"
        int capacity "nullable"
        timestamp deleted_at "nullable"
    }
    warehouse_locations {
        uuid id PK
        uuid warehouse_id FK
        string code "UK with warehouse_id"
        string name
        enum type "RECEIVING|PICKING|STORAGE|QUARANTINE|DAMAGED|RETURNS|STAGING"
        boolean active
    }
    inventory_items {
        uuid id PK
        uuid product_sku_id "UK with warehouse_id+location_id, -> catalog.product_skus.id, unenforced"
        uuid warehouse_id FK
        uuid location_id FK
        int on_hand_quantity "cache of inventory_ledger sum"
        int reserved_quantity
        int available_quantity "on_hand - reserved - damaged - quarantined - blocked"
        int in_transit_quantity
        int damaged_quantity
        int quarantined_quantity
        int blocked_quantity
        int version "optimistic-lock marker"
    }
    inventory_thresholds {
        uuid id PK
        uuid product_sku_id "UK with warehouse_id"
        uuid warehouse_id FK
        int reorder_point
        int safety_stock
        int min_stock "nullable"
        int max_stock "nullable"
    }
    inventory_ledger {
        uuid id PK
        uuid inventory_item_id FK
        uuid product_sku_id
        uuid warehouse_id
        uuid location_id FK
        enum movement_type "13-value vocabulary, see Enums"
        int quantity
        int before_on_hand
        int after_on_hand
        int before_reserved
        int after_reserved
        string reference_type "nullable, polymorphic"
        uuid reference_id "nullable, polymorphic"
        string reason "nullable"
        uuid actor_user_id "nullable, -> identity.users.id, unenforced"
        uuid correlation_id "groups related ledger rows"
        timestamp created_at "append-only, no updated_at"
    }
    inventory_reservations {
        uuid id PK
        uuid product_sku_id
        uuid warehouse_id
        uuid location_id
        uuid inventory_item_id FK
        int quantity
        enum status "ACTIVE|RELEASED|CONVERTED|EXPIRED|CANCELLED"
        string source_type "polymorphic, e.g. CART|ORDER|POS|MANUAL"
        uuid source_id "polymorphic, unenforced"
        string idempotency_key UK
        timestamp expires_at "nullable"
        timestamp released_at "nullable"
    }
    stock_transfers {
        uuid id PK
        string reference_number UK "e.g. TRF-..."
        uuid source_warehouse_id FK
        uuid destination_warehouse_id FK
        enum status "9-state, see Enums"
        uuid requested_by "nullable, -> identity.users.id, unenforced"
        uuid approved_by "nullable, -> identity.users.id, unenforced"
        timestamp dispatched_at "nullable"
        timestamp received_at "nullable"
    }
    stock_transfer_items {
        uuid id PK
        uuid transfer_id FK
        uuid product_sku_id "UK with transfer_id"
        int requested_quantity
        int approved_quantity "nullable"
        int dispatched_quantity "nullable"
        int received_quantity "nullable"
    }
    inventory_adjustments {
        uuid id PK
        uuid warehouse_id FK
        uuid location_id FK
        uuid product_sku_id
        enum adjustment_type "POSITIVE|NEGATIVE"
        int quantity
        string reason "required, not nullable"
        uuid approved_by "nullable, -> identity.users.id, unenforced"
        uuid created_by "-> identity.users.id, unenforced"
    }
    stock_counts {
        uuid id PK
        uuid warehouse_id FK
        uuid location_id "nullable, FK, ON DELETE SET NULL"
        enum status "PLANNED|IN_PROGRESS|COUNTED|UNDER_REVIEW|APPROVED|REJECTED|CLOSED"
        uuid counted_by "nullable, -> identity.users.id, unenforced"
        uuid approved_by "nullable, -> identity.users.id, unenforced"
        timestamp started_at "nullable"
        timestamp completed_at "nullable"
    }
    stock_count_items {
        uuid id PK
        uuid stock_count_id FK
        uuid product_sku_id "UK with stock_count_id"
        int expected_quantity "snapshot at count creation"
        int counted_quantity "nullable"
        int variance "nullable, counted - expected"
    }
```

## Key design decisions

**`InventoryItem` is keyed `(product_sku_id, warehouse_id, location_id)`,
not just `(product_sku_id, warehouse_id)`.** A warehouse must have at least
one `WarehouseLocation` before it can hold stock — `WarehousesService.create()`
auto-creates a default `STORAGE`-type location named `MAIN` in the same
transaction as the warehouse row, so every warehouse created through the API
can immediately receive stock. See ADR-006 decision 1.

**Quantity buckets on `InventoryItem` are a maintained cache; `InventoryLedger`
is the source of truth.** All seven quantity columns (`on_hand_quantity`
through `blocked_quantity`, plus `available_quantity`) are recomputed and
written in the same transaction as the corresponding `InventoryLedger` row —
never trusted as already-correct input, never mutated by any code path that
skips writing a ledger entry. `InventoryLedger` has no `updated_at` column
and no repository method updates or deletes a row (append-only, ADR-006
decision 2).

**No database `CHECK` constraint for `available_quantity >= 0`.** Confirmed
directly against this Prisma version: `@@check(...)` is not a valid schema
attribute (`P1012`). The invariant is enforced transactionally instead —
`SELECT ... FOR UPDATE` row-locks the `InventoryItem`, then
`AvailableQuantityCalculator.assertNonNegative` runs before any write, inside
the same transaction as the write itself (ADR-006 decision 3). `version` is
a secondary optimistic-locking marker, incremented on every write, for a
future non-transactional caller — not load-bearing for correctness today
since the row lock already is.

**`inventory_ledger.reference_type`/`reference_id` and
`inventory_reservations.source_type`/`source_id` are deliberately
polymorphic, not foreign keys.** Same "cross-schema references are
intentionally unenforced" convention `docs/database/README.md` documents,
extended to same-schema polymorphic references here — the reservation's
source (a future cart, order, POS sale, or home-try-on) doesn't exist as a
table yet, and the ledger's reference (a transfer, adjustment, reservation,
or future order) varies by movement type. `correlation_id` is the mechanism
that ties related ledger rows together instead (e.g. a transfer dispatch's
two `TRANSFER_OUT` rows for one item share a `correlation_id`).

**`inventory_thresholds` is keyed `(product_sku_id, warehouse_id)`,
deliberately decoupled from `location_id`.** Low-stock rules are per-SKU-
per-warehouse per the brief's own wording — location-level granularity would
be a finer boundary than anything the brief asks for (ADR-006 decision 6).

**`stock_counts.location_id` is nullable with `ON DELETE SET NULL`**
(Prisma's default for an unannotated optional relation) — a count can be
scoped to a whole warehouse (all locations) or narrowed to one location.

## Cross-schema references (unenforced, same convention as `catalog`)

`inventory_items.product_sku_id`, `inventory_ledger.product_sku_id`,
`inventory_thresholds.product_sku_id`, `inventory_reservations.product_sku_id`,
`stock_transfer_items.product_sku_id`, `inventory_adjustments.product_sku_id`,
and `stock_count_items.product_sku_id` all reference
`catalog.product_skus.id` without a database foreign key — same rationale
`docs/database/README.md`'s "Cross-schema references are intentionally
unenforced" section gives for every other cross-schema pointer in this
repo. `*_by`/`actor_user_id` columns referencing `identity.users.id` follow
the same pattern.

## Migration

`packages/database/prisma/migrations/20260812180528_inventory_warehouse_ledger_foundation/`
— hand-authored, with a `down.sql` verified via a full up → down → up round
trip against real Postgres (`prisma migrate diff` confirmed zero drift at
every step, and Phase 005's catalog seed data survived the round trip
intact). See that migration's own header comment for the exact data-
preserving mapping from Phase 003's placeholder shape.
