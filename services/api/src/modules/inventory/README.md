# modules/inventory

Phase 006's clean-architecture module for multi-warehouse inventory,
warehouse/location management, an append-only stock ledger, reservations,
transfers, adjustments, and stock counts. Same layering convention
`modules/identity` and `modules/catalog` established (see either module's own
README for the full explanation of the pattern):

```
inventory/
├── domain/
│   ├── entities/    — plain TS classes: Warehouse, WarehouseLocation,
│   │                  InventoryItem, InventoryThreshold, InventoryLedgerEntry,
│   │                  InventoryReservation, StockTransfer, StockTransferItem,
│   │                  InventoryAdjustment, StockCount, StockCountItem.
│   │                  No Prisma/NestJS dependency.
│   ├── ports/       — one repository interface (+ DI token) per entity, plus
│   │                  three integration ports (SkuLookupPort,
│   │                  AllocationRulesRepositoryPort) and three queue-facing
│   │                  ports the application layer depends on instead of
│   │                  BullMQ directly (InventoryEventPublisherPort,
│   │                  ReservationExpirationSchedulerPort,
│   │                  LowStockCheckSchedulerPort — see "Queues" below).
│   └── services/    — pure business logic, zero I/O, unit-tested without a
│                      database (44 tests across 7 spec files):
│                        AvailableQuantityCalculator — the never-negative invariant
│                        ReservationRules             — reservation state guards
│                        TransferStateMachine          — the 9-state transfer graph
│                        AdjustmentValidator           — adjustment guards
│                        StockCountVarianceCalculator  — expected vs. counted
│                        LowStockEvaluator             — threshold breach logic
│                        AllocationEngine              — config-driven, explainable
├── application/     — one service per entity/concern (WarehousesService,
│                      LocationsService, StockQueryService, LedgerService,
│                      ReservationService, TransferService, AdjustmentService,
│                      StockCountService, LowStockService, AllocationService).
├── infrastructure/
│   ├── repositories/          — one Prisma-backed implementation per port.
│   ├── inventory-item-mutator.ts — the single function every quantity-
│   │                                mutating operation funnels through (see
│   │                                "Concurrency safety" below).
│   ├── ledger-entry.mapper.ts — shared Prisma-row → domain-entity mappers.
│   └── queues/                — BullMQ producers/consumers (see "Queues").
└── presentation/
    ├── controllers/  — 7 admin controllers (under /admin/inventory/*), 2
    │                   internal controllers (/internal/inventory/*), 1
    │                   public storefront controller
    │                   (/catalog/products/:slug/{availability,stores},
    │                   @Public(), lives here rather than in modules/catalog —
    │                   see ADR-006 decision 10).
    ├── dto/           — request/response DTOs, class-validator + @nestjs/swagger.
    └── filters/       — InventoryDomainExceptionFilter (see its own doc comment).
```

Dependency direction is one-way:
`presentation → application → domain ← infrastructure`, verified the same way
identity/catalog's is — `domain/services/*.spec.ts` unit-tests the pure logic
with zero DB, zero NestJS test module, zero mocks.

Full design rationale for every non-obvious decision below:
[`docs/adr/ADR-006-inventory-architecture.md`](../../../../../docs/adr/ADR-006-inventory-architecture.md).

## The ledger is the source of truth, quantities are a cache

`InventoryItem`'s seven quantity buckets (`onHandQuantity`, `reservedQuantity`,
`availableQuantity`, `inTransitQuantity`, `damagedQuantity`,
`quarantinedQuantity`, `blockedQuantity`) are a **maintained cache** —
convenient for fast reads, never trusted as the reason something is what it
is. `InventoryLedger` is append-only (no repository method ever updates or
deletes a row) and is the authoritative history of every mutation: what
changed, by how much, why, who, and a `correlationId` tying related rows
together (e.g. a transfer dispatch's two `TRANSFER_OUT` rows). Every write
path funnels through `mutateInventoryItem()`
(`infrastructure/inventory-item-mutator.ts`), which writes the item's new
quantities and the ledger row **in the same transaction** — there is no
"quantity changed but no ledger row" path and no direct-mutation endpoint
anywhere in this module (the brief's own absolute rule).

## Concurrency safety

`available = on_hand - reserved - damaged - quarantined - blocked` must never
go negative, even under real concurrent load. Two mechanisms, both inside
`mutateInventoryItem()`:

1. **`SELECT ... FOR UPDATE`** (raw SQL via `Prisma.sql`, inside
   `prisma.$transaction`) row-locks the `InventoryItem` for the duration of
   the transaction — this is the actual serialization mechanism.
2. **A `version` column**, incremented on every write — a secondary
   optimistic-locking marker for future compare-and-swap callers; not load-
   bearing for correctness today (the row lock already is), but the seam a
   future non-transactional caller (e.g. a read-modify-write from outside
   this module) would need.

`AvailableQuantityCalculator.assertNonNegative` runs inside the same
transaction, before any write — an over-reservation throws
`InsufficientStockError` (mapped to `409` by `InventoryDomainExceptionFilter`)
and the transaction rolls back cleanly; there is no partial-write state to
clean up. Proven under real concurrent load — both as a standalone script
during development and as a real Jest e2e case
(`test/inventory.e2e-spec.ts`'s "Concurrency safety (mandatory)" suite): 100
simultaneous reservation requests against 10 available units of real stock in
real Postgres yield exactly 10 successes, 0 oversells, and a fully consistent
final state.

Prisma has no native `@@check(...)` schema attribute (confirmed directly
against this Prisma version — `P1012`), so the never-negative invariant is
not a database constraint; it is enforced transactionally, in this one
centralized function, by every caller (see ADR-006 decision 3).

## Reservation engine

`ReservationService.reserve()` is idempotent by construction: `idempotencyKey`
is a required, unique column, and a retried call with the same key returns
the original reservation rather than creating a second one or erroring.
`sourceType`/`sourceId` are deliberately polymorphic and unenforced by a
foreign key (`ADR-006` decision 5, matching the existing polymorphic-
reference convention already used elsewhere in this repo) — no cart,
checkout, order, or POS module exists yet to reference; a future one would
pass e.g. `sourceType: 'CART', sourceId: <cartId>`. `release()` and
`convert()` are the two terminal operations on an `ACTIVE` reservation
(`ReservationRules` enforces the state guards); a third path,
**expiration**, runs asynchronously off a BullMQ delayed job keyed by
reservation id (see "Queues" below) rather than a synchronous TTL check on
read.

## Stock transfers

`TransferStateMachine` enforces
`DRAFT → REQUESTED → APPROVED → PICKING → DISPATCHED → IN_TRANSIT → {PARTIALLY_RECEIVED|RECEIVED}`,
with `CANCELLED` reachable from any non-terminal state. This module's
`dispatch` endpoint collapses `APPROVED → PICKING → DISPATCHED` into one call,
and `receive` collapses `DISPATCHED → IN_TRANSIT → {PARTIALLY_RECEIVED|RECEIVED}`
into one call — a deliberate simplification: the brief's endpoint list has no
separate picking/in-transit-marking endpoints, only
`approve`/`dispatch`/`receive`. Dispatch writes **two** `TRANSFER_OUT` ledger
entries per item (source on-hand decrement + destination in-transit
increment, same `correlationId`) describing one physical event; receive
writes **one** `TRANSFER_IN` entry per item (destination in-transit decrement

- on-hand increment) — the brief specifies exactly these two movement type
  names for what is physically a three-step process, so this is the documented
  interpretation, not an oversight.

## Multi-store support

`Warehouse.type` includes `STORE` alongside `CENTRAL`/`REGIONAL`/
`DARK_STORE`/`QUARANTINE` — a retail store is not a special case in this
schema, it's the same `Warehouse`/`WarehouseLocation`/`InventoryItem`/
`InventoryLedger` model every other warehouse type uses. The seed fixture
demonstrates this directly: a `STORE`-type warehouse holding real stock for
the same SKU a `CENTRAL` warehouse also stocks, with its own reservation and
ledger history.

## Barcode / SKU lookup — without duplicating product identity

`SkuLookupPort` is a deliberately minimal port (`findById`/`findByBarcode`/
`findBySkuCode`/`findByProductSlug`) backed by `PrismaSkuLookupRepository`,
which reads `catalog.product_skus` directly — this module does **not** import
`modules/catalog`'s domain/application layers. `barcode`/`skuCode` are
already unique-indexed on `product_skus` from Phase 005; this module adds no
new identity concept for a SKU, satisfying the brief's "integrate with Phase
005's Product/SKU model without duplicating product identity" rule (ADR-006
decision 10).

## Procurement (Phase 021) — real, built on the Phase 006 readiness seam

`InventoryLedger`'s `PURCHASE_RECEIPT`/`RETURN_RECEIPT`/`QUARANTINE`/
`RELEASE_FROM_QUARANTINE` movement types and polymorphic
`referenceType`/`referenceId` columns were prepared, unused, back in
Phase 006 specifically for this (ADR-006 decision 9) — `RETURN_RECEIPT`
was picked up first by returns (ADR-012), and `PURCHASE_RECEIPT` is now
real too: `Supplier` (vendor master data) and `PurchaseOrder`/
`PurchaseOrderItem` (a real 6-state lifecycle —
`DRAFT → SUBMITTED → APPROVED → PARTIALLY_RECEIVED/RECEIVED`, or
`CANCELLED` before receiving starts) live in this same module.
`POST .../purchase-orders/:id/receive` writes `PURCHASE_RECEIPT` /
`referenceType: 'PURCHASE_ORDER'` ledger rows through
`mutateInventoryItem()` — the exact same shared, transaction-composable
primitive every other quantity mutation in this module funnels through
— inside one transaction with the order's own `receivedQuantity`
update, and is idempotent under retry (see
`docs/adr/ADR-021-procurement.md` for the full account, including a
defect found and fixed during this phase's own concurrency testing).
Full scope: `docs/product/procurement.md`. Deliberately not built this
phase: quotations, multi-level approval, attachments, multi-currency,
three-way matching, reporting, or any admin-frontend UI — see that
document's own "What's explicitly not real yet" section.

## Allocation engine — configuration-driven, explainable

`AllocationEngine` (pure domain service, `allocation-engine.spec.ts`) picks a
warehouse for a requested quantity using rules read from a single
`system.Setting` row (`key: 'inventory.allocation_rules'`, a JSON array of
`{type, priority, params}` — reusing the existing generic key-value config
store rather than a new dedicated table, ADR-006 decision 7). Rule types:
`NEAREST_WAREHOUSE`, `HIGHEST_STOCK`, `LOWEST_STOCK`, `PRIORITY_WAREHOUSE`,
`ROUND_ROBIN`, `COST_OPTIMIZED`, `FASTEST_FULFILLMENT` — never hardcoded,
per the brief's own rule. Every result includes an `explanation` array (which
rule fired, why a candidate was picked or skipped) — `AllocationService`
never bypasses the reservation engine; it only decides **which** warehouse a
subsequent `reserve()` call should target.

## Queues (BullMQ, in-process in `services/api`)

Three queues, registered by `InventoryQueueModule` (imported by
`InventoryModule`, not by `services/worker` — ADR-006 decision 8, because
these processors need the exact same domain services/Prisma transactional
context as the HTTP controllers, not a separate process's DI graph):

| Queue                        | Producer                            | Job id                     | Purpose                                                                                                                                                                                                                                     |
| ---------------------------- | ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reservation_expiration`     | `ReservationExpirationQueueService` | the reservation's own id   | Delayed job scheduled at `reserve()` time when `expiresAt` is set; expires the reservation asynchronously.                                                                                                                                  |
| `low_stock_notification`     | `LowStockQueueService`              | `skuId__warehouseId`       | Enqueued after any mutation that can only decrease availability; re-evaluates thresholds and publishes `inventory_low_stock` when actually low. Many mutations to the same SKU/warehouse in a short window collapse into one pending check. |
| `inventory_event_processing` | `InventoryEventsQueueService`       | `eventName__correlationId` | Publishes the 8 brief-mandated events (see below); the processor only logs — never a second source of truth.                                                                                                                                |

BullMQ rejects a custom job id containing `:` (`Error: Custom Id cannot
contain :`, discovered against a real running queue) — job ids above use
`__` as the separator, not `:`, for exactly that reason.

Events published: `inventory_reserved`, `inventory_reservation_released`,
`inventory_reservation_expired`, `inventory_transfer_created`,
`inventory_transfer_dispatched`, `inventory_transfer_received`,
`inventory_adjusted`, `inventory_low_stock`. Every field in a job payload is
also present in `inventory_ledger` or the entity's own row — the job is
metadata about a mutation that already committed to PostgreSQL, never the
only record of it (the brief's own "never a second source of truth" rule).

Application services depend on three port tokens
(`INVENTORY_EVENT_PUBLISHER`, `RESERVATION_EXPIRATION_SCHEDULER`,
`LOW_STOCK_CHECK_SCHEDULER`), not the BullMQ producer classes directly — the
producers implement these ports and are bound via
`{ provide: TOKEN, useExisting: ConcreteClass }`. `InventoryQueueModule`
re-declares its own full `ReservationService`/`LowStockService` provider
graphs for its processors — a second instance from the one `InventoryModule`
provides for its controllers, the same NestJS-DI-is-hierarchical precedent
`catalog.module.ts` set with `AUDIT_LOG_REPOSITORY`. Requires `REDIS_URL`
(`services/api/.env.example`, defaults to `redis://localhost:6379`).

## What's actually implemented (Phase 006)

Warehouse/location management, the full inventory item + ledger model,
reservations (create/release/convert/async-expire, idempotent), stock
transfers (full lifecycle), stock adjustments (with the "warehouse operators
cannot approve their own sensitive adjustments" rule enforced by simply never
granting `inventory.adjust` to the `warehouse_operator` role — not an extra
runtime check), stock counts (create/submit/approve/reject with variance
calculation), low-stock evaluation + reporting, barcode/SKU lookup, the
allocation engine, all 3 BullMQ queues, and a public storefront availability
read surface. 13 real RBAC permissions, 4 new roles
(`inventory_manager`/`warehouse_operator`/`store_manager`/
`inventory_auditor`), reusing Phase 004's guards/RBAC/audit infrastructure
wholesale (this is the second real writer of `system.AuditLog`, after
catalog).

## Deliberately out of scope for this pass

- **No Next.js admin/storefront pages** — same precedent Phase 004/005 set;
  see `docs/product/inventory.md`.
- **No separate service-to-service auth** for `/internal/inventory/*` — those
  routes sit behind the same `JwtAuthGuard`/`AuthorizationGuard` (via
  `@RequireModule('inventory')`) as every admin route; "internal" describes
  the URL prefix a future service-to-service caller would use, not a
  different auth model.
- **No procurement quotations/multi-level approval/attachments/reporting**
  — Phase 021 built the core Supplier + PurchaseOrder lifecycle; see
  `docs/product/procurement.md`'s own "What's explicitly not real yet"
  for the full deferred list. `QUARANTINE`/`RELEASE_FROM_QUARANTINE`
  remain unused ledger vocabulary for a still-later phase.
- **No notification fan-out** (SMS/email/push) off `inventory_low_stock` —
  the event is observable (a log line via the queue's own processor, a
  metric) but doesn't reach a human yet.
- **No live carrier-rate integration** for transfers — `StockTransfer` has no
  shipping-cost/carrier fields this pass.
- **No inventory valuation** (COGS/weighted-average-cost computation) — the
  ledger has enough history to compute one later; nothing computes it today.
- **No separate picking/in-transit-marking endpoints** — `dispatch`/`receive`
  each collapse two state transitions into one call (see "Stock transfers"
  above).

Full list with reasoning: `docs/adr/ADR-006-inventory-architecture.md`'s
"Deferred" section.

## Testing

```bash
pnpm --filter @iecp/api test        # unit — 7 domain-service spec files (44 tests), no DB
pnpm --filter @iecp/api test:e2e    # e2e — requires a migrated + seeded DATABASE_URL + REDIS_URL
```

`domain/services/*.spec.ts` are the fast, DB-free proofs of the never-
negative invariant, reservation state guards, the transfer state machine,
adjustment validation, count variance calculation, low-stock evaluation,
allocation rule selection, and (Phase 021) the purchase order state
machine + line validator. `test/inventory.e2e-spec.ts` is the full-stack
proof against real Postgres + real Redis: unauthorized access, public
storefront availability, warehouse-management RBAC, the reservation
lifecycle (including idempotency and over-reservation rejection), adjustment
RBAC across all four inventory roles, the full transfer lifecycle with
per-step RBAC, the stock count lifecycle, barcode/SKU lookup, and the
mandatory 100-simultaneous-reservations-against-10-units concurrency proof —
logging in as the seed's real `admin`/`inventory_manager`/
`warehouse_operator`/`store_manager`/`inventory_auditor` fixture users via the
real OTP flow, not fabricated tokens. `test/procurement.e2e-spec.ts`
covers supplier/purchase-order RBAC, line validation, the full
create→approve→receive lifecycle, partial receiving, cancellation,
over-receive rejection, a sequential idempotent-retry proof, and a
20-way-concurrent identical-request proof (exactly one receipt applied,
not 20).

## Config

- `REDIS_URL` (`services/api/src/config/env.ts`, defaults to
  `redis://localhost:6379`) — required for the 3 BullMQ queues. Same env var
  name `services/worker` already established.
- Otherwise reuses `services/api`'s existing `DATABASE_URL`/identity JWT
  config wholesale — every admin/internal route sits behind the same global
  `JwtAuthGuard`/`AuthorizationGuard` Phase 004 installed.
