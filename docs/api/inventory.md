# Inventory API (Phase 006)

Endpoint reference for `services/api/src/modules/inventory`. This document
follows [`README.md`](./README.md)'s conventions (`/api/v1` base path,
whitelist validation, no GraphQL) — read that document first for what
applies to every endpoint in the service, not just this module's. For the
generated, always-in-sync spec, run the service and open `/api/v1/docs`; the
tables below are a hand-maintained companion for reviewing scope without
booting anything.

Module-level design detail (layering, granularity, what's deliberately not
built): [`services/api/src/modules/inventory/README.md`](../../services/api/src/modules/inventory/README.md).
Permission matrix: [`docs/security/inventory-security.md`](../security/inventory-security.md).

## Auth

Every `admin/inventory/*` and `internal/inventory/*` route sits behind the
same global guards Phase 004 installed (`JwtAuthGuard` +
`AuthorizationGuard`) — nothing in this module registers its own auth. Two
decorators gate routes, matching `modules/catalog`'s own convention:

- `@RequireModule('inventory')` — any authenticated user holding **any**
  `inventory.*` permission may call the route (used for read/list endpoints
  and the `/internal/*` reservation seam — see "Internal" below).
- `@RequirePermission('inventory.<action>')` — the caller must hold that
  exact permission (used for every mutation with a real least-privilege
  boundary).

`catalog/products/:slug/{availability,stores}` (under the `catalog` prefix,
not `inventory`) is a public storefront surface — `@Public()`, no token
required.

## Admin — warehouses & locations

| Method | Path                                        | Guard                        | Notes                                                                                 |
| ------ | ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/admin/inventory/warehouses`               | `@RequireModule`             | Paginated list                                                                        |
| GET    | `/admin/inventory/warehouses/:id`           | `@RequireModule`             |                                                                                       |
| POST   | `/admin/inventory/warehouses`               | `inventory.warehouse.manage` | Auto-creates one default `STORAGE`-type location named `MAIN` in the same transaction |
| PATCH  | `/admin/inventory/warehouses/:id`           | `inventory.warehouse.manage` |                                                                                       |
| GET    | `/admin/inventory/warehouses/:id/locations` | `@RequireModule`             |                                                                                       |
| POST   | `/admin/inventory/locations`                | `inventory.warehouse.manage` | A warehouse must have ≥1 location before it can hold stock (ADR-006 decision 1)       |

## Admin — stock, ledger, low-stock, lookup

| Method | Path                                   | Guard                   | Notes                                                                                                            |
| ------ | -------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/inventory/stock`               | `@RequireModule`        | Filterable by warehouse/SKU                                                                                      |
| GET    | `/admin/inventory/stock/:skuId`        | `@RequireModule`        | Per-warehouse breakdown for one SKU                                                                              |
| GET    | `/admin/inventory/low-stock`           | `@RequireModule`        | Reads `InventoryThreshold`, never a hardcoded floor                                                              |
| PUT    | `/admin/inventory/low-stock/threshold` | `inventory.update`      | Upsert `reorderPoint`/`safetyStock`/`minStock`/`maxStock` for one SKU+warehouse                                  |
| GET    | `/admin/inventory/barcode/:code`       | `@RequireModule`        | Resolves `catalog.product_skus.barcode`, does not import catalog's domain layer                                  |
| GET    | `/admin/inventory/sku-code/:code`      | `@RequireModule`        | Resolves `catalog.product_skus.sku_code`                                                                         |
| GET    | `/admin/inventory/ledger`              | `inventory.ledger.read` | Filterable by inventoryItemId/productSkuId/warehouseId/referenceType+referenceId/correlationId; cursor-paginated |

`InventoryLedger` is append-only — there is no PATCH/DELETE endpoint on
`/admin/inventory/ledger`, and no repository method exists to update or
delete a ledger row.

## Admin — adjustments

| Method | Path                           | Guard                   | Notes                                                                                                                   |
| ------ | ------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/inventory/adjustments` | `inventory.ledger.read` |                                                                                                                         |
| POST   | `/admin/inventory/adjustments` | `inventory.adjust`      | `adjustmentType: POSITIVE \| NEGATIVE`; validated by `AdjustmentValidator`; writes one ledger entry + `system.AuditLog` |

`warehouse_operator` is never granted `inventory.adjust` — the brief's
"warehouse operators cannot approve their own sensitive adjustments" rule is
enforced by simply never granting the permission to that role, not an extra
runtime check (see `docs/security/inventory-security.md`).

## Admin — stock transfers

| Method | Path                                      | Guard                         | Notes                                                                                                                                           |
| ------ | ----------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/inventory/transfers`              | `inventory.ledger.read`       | Filterable by status/sourceWarehouseId/destinationWarehouseId                                                                                   |
| GET    | `/admin/inventory/transfers/:id`          | `inventory.ledger.read`       | Includes line items (`StockTransferWithItems`) — the list endpoint does not                                                                     |
| POST   | `/admin/inventory/transfers`              | `inventory.transfer.create`   | `DRAFT/REQUESTED`; `referenceNumber` auto-generated (`TRF-...`)                                                                                 |
| POST   | `/admin/inventory/transfers/:id/approve`  | `inventory.transfer.approve`  | `REQUESTED → APPROVED`; per-item `approvedQuantity` optional override                                                                           |
| POST   | `/admin/inventory/transfers/:id/dispatch` | `inventory.transfer.dispatch` | Collapses `APPROVED → PICKING → DISPATCHED`; writes 2 `TRANSFER_OUT` ledger rows per item (source decrement + destination in-transit increment) |
| POST   | `/admin/inventory/transfers/:id/receive`  | `inventory.transfer.receive`  | Collapses `DISPATCHED → IN_TRANSIT → {PARTIALLY_RECEIVED\|RECEIVED}`; writes 1 `TRANSFER_IN` ledger row per item                                |

Every transition not on `TransferStateMachine`'s graph is a **409**, mapped
by `InventoryDomainExceptionFilter` — not a silent no-op and not an
unhandled 500.

## Admin — stock counts

| Method | Path                                  | Guard                     | Notes                                                                                      |
| ------ | ------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/admin/inventory/counts`             | `inventory.ledger.read`   | Filterable by warehouseId/status                                                           |
| GET    | `/admin/inventory/counts/:id`         | `inventory.ledger.read`   | Includes line items                                                                        |
| POST   | `/admin/inventory/counts`             | `inventory.count.create`  | Snapshots `expectedQuantity` per SKU at creation time                                      |
| POST   | `/admin/inventory/counts/:id/submit`  | `inventory.count.create`  | `PLANNED/IN_PROGRESS → COUNTED`; computes `variance` per item                              |
| POST   | `/admin/inventory/counts/:id/approve` | `inventory.count.approve` | `COUNTED → APPROVED`; writes one `COUNT_ADJUSTMENT` ledger entry per nonzero-variance item |
| POST   | `/admin/inventory/counts/:id/reject`  | `inventory.count.approve` | `COUNTED → REJECTED`; no ledger writes                                                     |

## Admin — suppliers & purchase orders (Phase 021)

| Method | Path                                           | Guard                              | Notes                                                                                                                                                                                                                 |
| ------ | ---------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/inventory/suppliers`                   | `inventory.supplier.manage`        | Filterable by status                                                                                                                                                                                                  |
| GET    | `/admin/inventory/suppliers/:id`               | `inventory.supplier.manage`        |                                                                                                                                                                                                                       |
| POST   | `/admin/inventory/suppliers`                   | `inventory.supplier.manage`        |                                                                                                                                                                                                                       |
| PATCH  | `/admin/inventory/suppliers/:id`               | `inventory.supplier.manage`        |                                                                                                                                                                                                                       |
| GET    | `/admin/inventory/purchase-orders`             | `inventory.ledger.read`            | Filterable by status/supplierId/warehouseId                                                                                                                                                                           |
| GET    | `/admin/inventory/purchase-orders/:id`         | `inventory.ledger.read`            | Includes line items — the list endpoint does not                                                                                                                                                                      |
| POST   | `/admin/inventory/purchase-orders`             | `inventory.purchase_order.create`  | `DRAFT/SUBMITTED`; `poNumber` auto-generated (`PO-...`); rejects duplicate SKU/non-positive quantity/negative cost                                                                                                    |
| POST   | `/admin/inventory/purchase-orders/:id/approve` | `inventory.purchase_order.approve` | `SUBMITTED → APPROVED`                                                                                                                                                                                                |
| POST   | `/admin/inventory/purchase-orders/:id/receive` | `inventory.purchase_order.receive` | `APPROVED/PARTIALLY_RECEIVED → {PARTIALLY_RECEIVED\|RECEIVED}`; writes one `PURCHASE_RECEIPT` ledger row per line; optional `idempotencyKey` — a retried call with the same key resolves to the already-applied state |
| POST   | `/admin/inventory/purchase-orders/:id/cancel`  | `inventory.purchase_order.create`  | Only from `DRAFT`/`SUBMITTED`/`APPROVED` — rejected once any receiving has happened                                                                                                                                   |

Every transition not on `PurchaseOrderStateMachine`'s graph, and every
line-validation failure (duplicate SKU, non-positive quantity, negative
cost, over-receipt), is mapped by `InventoryDomainExceptionFilter` —
transitions to **409**, line validation to **400** — never a silent
no-op and never an unhandled 500.

## Internal — reservations (the future cart/checkout/POS seam)

| Method | Path                                           | Guard            | Notes                                                                                                                                              |
| ------ | ---------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/internal/inventory/reservations/:id`         | `@RequireModule` |                                                                                                                                                    |
| POST   | `/internal/inventory/reservations`             | `@RequireModule` | `sourceType`/`sourceId` are polymorphic, unenforced; `idempotencyKey` optional — a retried call with the same key returns the original reservation |
| POST   | `/internal/inventory/reservations/:id/release` | `@RequireModule` | `ACTIVE → RELEASED`                                                                                                                                |
| POST   | `/internal/inventory/reservations/:id/convert` | `@RequireModule` | `ACTIVE → CONVERTED`; optional `referenceType`/`referenceId` (e.g. `ORDER`)                                                                        |

"Internal" describes the URL prefix a future service-to-service caller (a
cart/checkout/POS/home-try-on module, none of which this phase implements)
would use — there is no separate service-to-service auth mechanism yet, so
these routes are behind the same `JwtAuthGuard`/`AuthorizationGuard` as
everything else (`docs/security/inventory-security.md`'s "Deliberately not
built this phase"). Over-reservation (requesting more than
`availableQuantity`) is a **409** (`InsufficientStockError`), not a silent
partial fill.

## Internal — availability

| Method | Path                                      | Guard            | Notes                                                         |
| ------ | ----------------------------------------- | ---------------- | ------------------------------------------------------------- |
| GET    | `/internal/inventory/availability/:skuId` | `@RequireModule` | Per-warehouse breakdown of all 7 quantity buckets for one SKU |

## Storefront (public, no auth)

| Method | Path                                   | Notes                                                                                         |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/catalog/products/:slug/availability` | Aggregate available quantity per warehouse for a published product's SKUs                     |
| GET    | `/catalog/products/:slug/stores`       | `STORE`-type warehouses only, with their available quantity — the "in stock near you" surface |

Registered under `modules/inventory/presentation/controllers/catalog-availability-public.controller.ts`,
mounted at the `catalog/products` prefix — coexists with
`modules/catalog`'s own public controller without either module importing
the other's domain layer (ADR-006 decision 10).

## Pagination

Cursor-based, the same base64url-encoded `{sortValue, id}` cursor
`modules/catalog` generalized from identity's audit-log pattern. Request
`?limit=&cursor=`; response `{items, nextCursor}` (`nextCursor: null` on the
last page).

## Errors

Four domain error types get a real HTTP mapping via
`InventoryDomainExceptionFilter` (`APP_FILTER`, scoped `@Catch()`):

| Domain error                       | HTTP status |
| ---------------------------------- | ----------- |
| `InsufficientStockError`           | 409         |
| `InvalidTransferTransitionError`   | 409         |
| `InvalidReservationOperationError` | 400         |
| `InvalidAdjustmentError`           | 400         |

This is intentionally narrower than `docs/api/README.md`'s noted-as-future
general error-shape standardization — it covers exactly this module's
domain-layer error types, not a service-wide `{success, error, requestId}`
envelope.
