# Catalog API (Phase 005)

Endpoint reference for `services/api/src/modules/catalog`. This document
follows [`README.md`](./README.md)'s conventions (`/api/v1` base path,
whitelist validation, no GraphQL) — read that document first for what
applies to every endpoint in the service, not just this module's. For the
generated, always-in-sync spec, run the service and open
`/api/v1/docs`; the tables below are a hand-maintained companion for
reviewing scope without booting anything.

Module-level design detail (layering, granularity, what's deliberately not
built): [`services/api/src/modules/catalog/README.md`](../../services/api/src/modules/catalog/README.md).
Permission matrix: [`docs/security/catalog-security.md`](../security/catalog-security.md).

## Auth

Every `admin/catalog/*` route sits behind the same global guards Phase 004
installed (`JwtAuthGuard` + `AuthorizationGuard`) — nothing in this module
registers its own auth. Two decorators gate admin routes, matching
`modules/identity`'s own convention:

- `@RequireModule('catalog')` — any authenticated user holding **any**
  `catalog.*` permission may call the route (used for read/list endpoints).
- `@RequirePermission('catalog.<action>')` — the caller must hold that
  exact permission (used for every mutation).

`catalog/*` (no `admin` prefix) is the storefront surface — every route on
it is `@Public()`, no token required.

## Admin — brands

| Method | Path                        | Guard                   | Notes                                  |
| ------ | --------------------------- | ----------------------- | -------------------------------------- |
| GET    | `/admin/catalog/brands`     | `@RequireModule`        | Cursor-paginated list                  |
| GET    | `/admin/catalog/brands/:id` | `@RequireModule`        |                                        |
| POST   | `/admin/catalog/brands`     | `catalog.brands.create` | Slug derived from `name` if omitted    |
| PATCH  | `/admin/catalog/brands/:id` | `catalog.brands.update` |                                        |
| DELETE | `/admin/catalog/brands/:id` | `catalog.brands.delete` | 409 if any product still references it |

## Admin — categories

| Method | Path                                    | Guard                       | Notes                                                  |
| ------ | --------------------------------------- | --------------------------- | ------------------------------------------------------ |
| GET    | `/admin/catalog/categories`             | `@RequireModule`            |                                                        |
| GET    | `/admin/catalog/categories/:id`         | `@RequireModule`            |                                                        |
| POST   | `/admin/catalog/categories`             | `catalog.categories.create` | `parentId` cycle-checked by `CategoryHierarchyService` |
| PATCH  | `/admin/catalog/categories/:id`         | `catalog.categories.update` |                                                        |
| POST   | `/admin/catalog/categories/:id/publish` | `catalog.categories.update` | Sets `publishedAt`; separate from `status`             |
| DELETE | `/admin/catalog/categories/:id`         | `catalog.categories.delete` | 409 if it has children or products                     |

## Admin — collections

| Method | Path                                                 | Guard                        | Notes                                           |
| ------ | ---------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| GET    | `/admin/catalog/collections`                         | `@RequireModule`             |                                                 |
| GET    | `/admin/catalog/collections/:id`                     | `@RequireModule`             |                                                 |
| GET    | `/admin/catalog/collections/:id/products`            | `@RequireModule`             | Resolves `DYNAMIC` rules or `MANUAL` membership |
| POST   | `/admin/catalog/collections`                         | `catalog.collections.create` | `type: MANUAL \| DYNAMIC`                       |
| PATCH  | `/admin/catalog/collections/:id`                     | `catalog.collections.update` |                                                 |
| DELETE | `/admin/catalog/collections/:id`                     | `catalog.collections.delete` |                                                 |
| POST   | `/admin/catalog/collections/:id/products`            | `catalog.collections.update` | Add to `MANUAL` membership                      |
| DELETE | `/admin/catalog/collections/:id/products/:productId` | `catalog.collections.update` | Remove from `MANUAL` membership                 |
| POST   | `/admin/catalog/collections/:id/products/reorder`    | `catalog.collections.update` | Bulk `sortOrder` update                         |

## Admin — products (publication lifecycle)

| Method | Path                                            | Guard                      | Notes                                                                                                             |
| ------ | ----------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/catalog/products`                       | `@RequireModule`           | Filterable by brand/category/status/productType/tags/search, sortable, paginated                                  |
| GET    | `/admin/catalog/products/:id`                   | `@RequireModule`           |                                                                                                                   |
| POST   | `/admin/catalog/products`                       | `catalog.products.create`  | Starts at `status = DRAFT`                                                                                        |
| PATCH  | `/admin/catalog/products/:id`                   | `catalog.products.update`  | Content edits only — never touches `status`                                                                       |
| DELETE | `/admin/catalog/products/:id`                   | `catalog.products.delete`  | Only `DRAFT`/`ARCHIVED` are deletable (`isDeletableStatus`)                                                       |
| POST   | `/admin/catalog/products/:id/submit-for-review` | `catalog.products.update`  | `DRAFT → IN_REVIEW`                                                                                               |
| POST   | `/admin/catalog/products/:id/approve`           | `catalog.products.approve` | `IN_REVIEW → APPROVED`; writes `system.AuditLog`                                                                  |
| POST   | `/admin/catalog/products/:id/reject`            | `catalog.products.approve` | `IN_REVIEW → DRAFT`                                                                                               |
| POST   | `/admin/catalog/products/:id/publish`           | `catalog.products.publish` | `APPROVED → PUBLISHED`; writes `system.AuditLog`                                                                  |
| POST   | `/admin/catalog/products/:id/unpublish`         | `catalog.products.publish` | `PUBLISHED → UNPUBLISHED`; writes `system.AuditLog`                                                               |
| POST   | `/admin/catalog/products/:id/archive`           | `catalog.products.archive` | Any non-`ARCHIVED` state → `ARCHIVED`; writes `system.AuditLog`                                                   |
| POST   | `/admin/catalog/products/bulk`                  | `catalog.products.bulk`    | `{operation: 'publish'\|'archive', ids: string[]}`, ≤200 ids, sequential, per-item result (`BulkOperationResult`) |

Every transition not on the graph in
[`ProductLifecycleStateMachine`](../../services/api/src/modules/catalog/domain/services/product-lifecycle-state-machine.ts)
(e.g. publishing a `DRAFT` directly) is a **409**, mapped by
`CatalogDomainExceptionFilter` — not a silent no-op and not an unhandled 500.

## Admin — variants & SKUs

| Method | Path                                          | Guard                     | Notes                            |
| ------ | --------------------------------------------- | ------------------------- | -------------------------------- |
| GET    | `/admin/catalog/products/:productId/variants` | `@RequireModule`          |                                  |
| POST   | `/admin/catalog/variants`                     | `catalog.variants.manage` |                                  |
| PATCH  | `/admin/catalog/variants/:id`                 | `catalog.variants.manage` |                                  |
| DELETE | `/admin/catalog/variants/:id`                 | `catalog.variants.manage` | 409 if it has a SKU              |
| GET    | `/admin/catalog/products/:productId/skus`     | `@RequireModule`          |                                  |
| POST   | `/admin/catalog/skus`                         | `catalog.skus.manage`     | One SKU per `variantId` (unique) |
| PATCH  | `/admin/catalog/skus/:id`                     | `catalog.skus.manage`     |                                  |
| DELETE | `/admin/catalog/skus/:id`                     | `catalog.skus.manage`     |                                  |

## Admin — media

| Method | Path                                                     | Guard                  | Notes                                                                                            |
| ------ | -------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| GET    | `/admin/catalog/media/:id`                               | `@RequireModule`       |                                                                                                  |
| POST   | `/admin/catalog/media`                                   | `catalog.media.manage` | Registers an already-hosted asset (`provider`/`storageKey`/`url`) — no upload endpoint this pass |
| DELETE | `/admin/catalog/media/:id`                               | `catalog.media.manage` | Restricted while any `product_media` row still references it                                     |
| GET    | `/admin/catalog/products/:productId/media`               | `@RequireModule`       |                                                                                                  |
| POST   | `/admin/catalog/products/:productId/media`               | `catalog.media.manage` | Attaches (optionally variant-scoped); `PRIMARY`-role exclusivity enforced in `MediaService`      |
| DELETE | `/admin/catalog/products/:productId/media/:attachmentId` | `catalog.media.manage` | Detach only, never deletes the underlying `media` row                                            |
| POST   | `/admin/catalog/products/:productId/media/reorder`       | `catalog.media.manage` | Bulk `sortOrder` update                                                                          |

## Admin — attributes

| Method | Path                                                     | Guard                       | Notes                                                                   |
| ------ | -------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| GET    | `/admin/catalog/attributes`                              | `@RequireModule`            |                                                                         |
| POST   | `/admin/catalog/attributes`                              | `catalog.attributes.manage` |                                                                         |
| GET    | `/admin/catalog/attributes/:id/values`                   | `@RequireModule`            |                                                                         |
| POST   | `/admin/catalog/attributes/:id/values`                   | `catalog.attributes.manage` |                                                                         |
| POST   | `/admin/catalog/variants/:variantId/attributes/:valueId` | `catalog.attributes.manage` | 409 on a second value of the same attribute (`AttributeValueValidator`) |
| DELETE | `/admin/catalog/variants/:variantId/attributes/:valueId` | `catalog.attributes.manage` |                                                                         |

## Admin — pricing

| Method | Path                                       | Guard                    | Notes                                                                                                                                                   |
| ------ | ------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/catalog/skus/:skuId/price`         | `@RequireModule`         | Current active price                                                                                                                                    |
| PUT    | `/admin/catalog/skus/:skuId/price`         | `catalog.pricing.manage` | Validated by `PriceValidator`; writes `finance.PriceHistory` + `system.AuditLog` `PRODUCT_PRICE_CHANGED`, same transaction as the `ProductPrice` upsert |
| GET    | `/admin/catalog/skus/:skuId/price/history` | `@RequireModule`         | Append-only trail                                                                                                                                       |

Money travels over HTTP as **decimal strings** (`SetPriceDto` uses
`@IsNumberString()`), never JSON numbers — `bigint` has no native JSON
representation, and a float would violate this repo's money convention
(see [`docs/database/README.md`](../database/README.md) convention 2).

## Storefront (public, no auth)

| Method | Path                                  | Notes                                                                                                    |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/catalog/products`                   | Filterable/sortable/paginated; only `status = PUBLISHED`, `deletedAt = null`                             |
| GET    | `/catalog/products/:slug`             | Full page aggregate — product + brand + category + every variant's SKU + price + all media, one response |
| GET    | `/catalog/categories`                 | Only `publishedAt` set                                                                                   |
| GET    | `/catalog/categories/:slug`           |                                                                                                          |
| GET    | `/catalog/brands`                     | Only `status = ACTIVE`                                                                                   |
| GET    | `/catalog/brands/:slug`               |                                                                                                          |
| GET    | `/catalog/collections`                | Only `status = ACTIVE` and within `startAt`/`endAt` window                                               |
| GET    | `/catalog/collections/:slug`          |                                                                                                          |
| GET    | `/catalog/collections/:slug/products` | Resolves `DYNAMIC` rules or `MANUAL` membership, storefront-visibility filtered                          |

Every `CatalogQueryService` method enforces its own "is this actually
publicly visible" filter rather than trusting the caller to remember it —
proven in `test/catalog.e2e-spec.ts`: the seed's own `DRAFT` product never
appears in a storefront listing or by direct slug lookup, even
unauthenticated.

## Pagination

Cursor-based, generalized from identity's audit-log pattern
(`services/api/src/modules/catalog/infrastructure/pagination.util.ts`): a
base64url-encoded `{sortValue, id}` JSON cursor, opaque to the client.
Request `?limit=&cursor=`; response `{items, nextCursor}` (`nextCursor:
null` on the last page).

## Errors

Three domain error types get a real HTTP mapping via
`CatalogDomainExceptionFilter` (`APP_FILTER`, scoped `@Catch()`):

| Domain error                    | HTTP status |
| ------------------------------- | ----------- |
| `InvalidProductTransitionError` | 409         |
| `InvalidPriceError`             | 400         |
| `InvalidAttributeValueError`    | 400         |

This is intentionally narrower than `docs/api/README.md`'s noted-as-future
general error-shape standardization — it covers exactly this module's
domain-layer error types, not a service-wide `{success, error, requestId}`
envelope (still not standardized end to end, see that document).

## Bulk operations

`POST /admin/catalog/products/bulk` is the one bulk endpoint this phase
ships (the JSON task spec's explicit ask), capped at 200 ids per request,
run **sequentially** — not `Promise.all` — so one bad id fails only itself;
the response is a `BulkOperationResult[]` (`{id, success, error?}` per
item), not an all-or-nothing transaction.
