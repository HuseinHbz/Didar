# Inventory architecture (Phase 006, reservation lifecycle hardened in CP-031)

Full design rationale: [`docs/adr/ADR-006-inventory-architecture.md`](../adr/ADR-006-inventory-architecture.md).
Full layering/scope detail: [`services/api/src/modules/inventory/README.md`](../../services/api/src/modules/inventory/README.md).
This document is the short "where does inventory fit in the system" view —
read it alongside [`docs/architecture/README.md`](README.md), which it
extends rather than replaces.

## Where it sits

```
storefront / admin / pwa / mobile
                │
        services/api (NestJS)
                │
        modules/inventory        ← Phase 006, this document
   (domain → application → infrastructure/presentation)
        │                    │
        │              modules/catalog (SkuLookupPort only —
        │               no import of catalog's domain/application layers)
        │
   BullMQ queues (in-process — reservation_expiration,
   low_stock_notification, inventory_event_processing)
        │                    │
   packages/database (Prisma)      Redis (queues only — never
        │                           authoritative for inventory state)
   PostgreSQL
   inventory schema
```

Same shape every other domain module in `services/api` follows
(`docs/architecture/README.md`'s "Backend: domain-based modules, clean-
architecture layering"), and the same shape `modules/identity` (Phase 004)
and `modules/catalog` (Phase 005) already demonstrated —
`modules/inventory` is the third full example, not a new pattern. It is,
however, the **first** module in this repo with its own background job
queues: three BullMQ queues registered in-process inside `services/api`
(not `services/worker`), because their processors need the exact same
domain services/Prisma transactional context as the HTTP controllers (see
ADR-006 decision 8).

## PostgreSQL is the single source of truth

The brief's own absolute rule, and the one architectural fact every other
decision in this module serves: Redis is used **only** for the three BullMQ
queues (job scheduling/retry/dead-letter), never to answer "what is the
available quantity of SKU X at warehouse Y" — every such read goes to
Postgres. There is no cache-then-fallback-to-DB read path for inventory
state anywhere in this module. `InventoryItem`'s quantity buckets are a
maintained cache of `InventoryLedger`'s history, but both live in the same
Postgres database, in the same transaction, written by the same
`mutateInventoryItem()` function — "cache" here means "derived and kept in
sync," not "a different, potentially-stale store."

## What changed outside `modules/inventory` itself

- **`packages/database/prisma/schema.prisma`** — the `inventory` schema was
  completely rewritten (`Warehouse`/`WarehouseLocation`/`InventoryItem`/
  `InventoryThreshold`/`InventoryLedger`/`InventoryReservation`/
  `StockTransfer`/`StockTransferItem`/`InventoryAdjustment`/`StockCount`/
  `StockCountItem` — see `docs/database/inventory-erd.md`), replacing the
  Phase 003 placeholder shape (`InventoryTransaction`, `StockReservation`).
- **`packages/types`** — 10 new branded IDs, 8 new enum unions matching the
  new Prisma enums, and `AllocationRule`/`AllocationResult` shapes for the
  allocation engine.
- **`services/api/app.module.ts`** — registers `InventoryModule` alongside
  `HealthModule`/`IdentityModule`/`CatalogModule`.
- **`services/api/src/config/env.ts`** and `.env.example`** — new
  `REDIS_URL` (defaults to `redis://localhost:6379`), the first inventory-
  specific env var in this service.
- **`services/api/package.json`** — `@nestjs/bullmq`/`bullmq`/`ioredis`,
  matching the exact versions `services/worker` already pins.
- **RBAC data** — 13 new `inventory.*` permissions in
  `packages/database/prisma/seed.ts`'s registry, granted across 4 new roles
  (`inventory_manager`, `warehouse_operator`, `store_manager`,
  `inventory_auditor`) — see `docs/security/inventory-security.md`.

Nothing in `modules/identity` itself changed; inventory reuses its guards,
decorators, and (as the second real writer, after catalog) its
`system.AuditLog` repository. Nothing in `modules/catalog`'s domain or
application layers is imported by `modules/inventory` — the one integration
point is `SkuLookupPort`, reading `catalog.product_skus` directly (see
ADR-006 decision 10 and the "Barcode / SKU lookup" section of the module
README).

## Frontend: deliberately not built this phase

`apps/admin` and `apps/storefront` are untouched — same precedent Phase 004/
005 set (see `docs/product/inventory.md`). The API surface this phase ships
(`docs/api/inventory.md`) is what a future frontend phase integrates
against, and what a future **cart/checkout/order/POS phase** integrates
against at the service level: `POST /internal/inventory/reservations` is the
exact seam those modules would call into (`sourceType: 'CART' | 'ORDER' |
'POS' | 'HOME_TRY_ON'`), without this phase implementing any of that
business logic.

## Concurrency and the never-negative invariant

The one property every other design choice in this module was checked
against: `available = on_hand - reserved - damaged - quarantined - blocked`
must never go negative, even under real concurrent load. Enforced via
`SELECT ... FOR UPDATE` row locking inside a Postgres transaction (not a
database `CHECK` constraint — Prisma has no `@@check(...)` support, confirmed
directly against this Prisma version), proven with a real, non-simulated
concurrency test: 100 simultaneous reservation requests against 10 available
units yield exactly 10 successes and 0 oversells (`test/inventory.e2e-spec.ts`'s
"Concurrency safety (mandatory)" suite, and ADR-006 decision 4).

## CP-031 — the reservation lifecycle is serialised on the reservation row

Full rationale: [`docs/adr/ADR-031-payment-order-consistency.md`](../adr/ADR-031-payment-order-consistency.md)
(decisions 4 and 7). The suite written to reproduce the order-side defects found a defect here that
reading the code had not: `release` and `convert` both read a reservation, decided it was `ACTIVE`,
and wrote — without locking the _reservation_ row (only the inventory item was locked). Twenty
concurrent `convert` calls on one reservation succeeded **9 and 10 times in two runs** (expected 1),
leaving phantom negative `reserved`/`on_hand` buckets that
`available = on_hand − reserved − …` happily netted to a healthy-looking positive number; in a
`release` × `convert` race 10 of 20 won in both runs.

- **Lock order is fixed: reservation row, then inventory item** (`SELECT … FOR UPDATE` on each, in
  that order — no deadlock between the two). `release`, `convert` and `expire` read the status only
  _after_ holding the reservation lock; the loser of a race sees a non-`ACTIVE` reservation and gets
  `ReservationNotActiveError` (`409` via the inventory exception filter).
- **Non-negativity is checked per stored bucket**, not only on the derived `available`
  (`AvailableQuantityCalculator.assertNonNegative`): two wrong buckets can cancel out in the sum.
- **`reserve()` is idempotent under concurrent callers with one key** — it hands back the winner's
  reservation instead of a spurious error, which the order module's re-acquire path
  (`order__<orderId>__<sku>`) relies on.
- **`StockSaleService`** (new, exported with `ReservationService`) classifies the outcome of
  selling a reservation as a _value_ — `SOLD` (also when an earlier or racing call already sold it:
  selling is exactly-once), `NOT_HELD`, `SHORT` — over the real, row-locked, ledger-writing
  `ReservationService`. It implements no stock rule of its own; unexpected failures propagate.
- **Not changed:** `getAvailability()` still returns one row per `(warehouse, location)` — the
  one-row-per-warehouse assumption in an old test was the bug (P2-16), fixed in the test. `reserve()`
  still takes a SKU's stock from the **single** location with the most available, so a SKU whose
  warehouse total suffices but is spread across locations is reported short — safe direction, but a
  false `STOCK_SHORTFALL` on the order module's re-acquire path (P2-17, owned by CP-040).
