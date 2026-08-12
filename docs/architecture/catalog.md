# Catalog architecture (Phase 005)

Full design rationale: [`docs/adr/ADR-005-catalog-architecture.md`](../adr/ADR-005-catalog-architecture.md).
Full layering/scope detail: [`services/api/src/modules/catalog/README.md`](../../services/api/src/modules/catalog/README.md).
This document is the short "where does catalog fit in the system" view —
read it alongside [`docs/architecture/README.md`](README.md), which it
extends rather than replaces.

## Where it sits

```
storefront / admin / pwa / mobile
                │
        services/api (NestJS)
                │
        modules/catalog          ← Phase 005, this document
   (domain → application → infrastructure/presentation)
                │
        packages/database (Prisma)
                │
           PostgreSQL
   catalog / finance / inventory schemas
```

Same shape every other domain module in `services/api` follows
(`docs/architecture/README.md`'s "Backend: domain-based modules, clean-
architecture layering"), and the same shape `modules/identity` already
demonstrated in Phase 004 — `modules/catalog` is the second full example,
not a new pattern.

## What changed outside `modules/catalog` itself

- **`packages/database/prisma/schema.prisma`** — the `catalog` schema was
  substantially extended (Brand/Category/Collection/Product/ProductVariant/
  ProductSku/Media/ProductMedia/ProductAttribute(+Value) — see
  `docs/database/catalog-erd.md`), and three tables outside `catalog`
  changed their cross-schema key: `inventory.InventoryItem`,
  `commerce.CartItem`, `commerce.OrderItem` all moved from
  `productVariantId` to `productSkuId` (ADR-005 decision 1).
  `finance.ProductPrice`/`PriceHistory` did the same and gained
  `compareAtPrice`/`validFrom`/`validTo`.
- **`packages/types`** — new branded IDs (`BrandId`, `CategoryId`,
  `CollectionId`, `ProductSkuId`, `MediaId`, `ProductAttributeId`,
  `ProductAttributeValueId`), catalog enums matching the new Prisma enums,
  and shared JSON-column shapes (`LocalizedText`, `SeoMetadata`,
  `CollectionRules`).
- **`packages/validation`** — `slug.ts`, a Persian-first slug strategy
  (validates lowercase Latin + Persian/Arabic-block text, hyphen-separated;
  `slugify()` derives one from a display name without transliterating to
  Latin — this project's storefront is fa-IR first).
- **`services/api/app.module.ts`** — registers `CatalogModule` alongside
  `HealthModule`/`IdentityModule`.
- **RBAC data** — 21 new `catalog.*` permissions in
  `packages/database/prisma/seed.ts`'s registry, granted to `admin`
  (everything) and a new `catalog_editor` role (create/update, not delete/
  publish/pricing) — see `docs/security/catalog-security.md`.

Nothing in `modules/identity` itself changed; catalog reuses its guards,
decorators, and (for the first time as an actual writer, not just a reader)
its `system.AuditLog` repository — see the module README's "Products" and
"Pricing" sections for exactly which mutations write an audit row.

## Frontend: deliberately not built this phase

`apps/admin` and `apps/storefront` are untouched — see ADR-005 decision 7.
The API surface this phase ships (`docs/api/catalog.md`) is what a future
frontend phase integrates against. Concretely, that phase would need:

- An admin product-authoring flow calling, in order: `POST
/admin/catalog/products` → `POST /admin/catalog/variants` → `POST
/admin/catalog/skus` → `POST /admin/catalog/products/:id/media` → `PUT
/admin/catalog/skus/:id/price` → the lifecycle verbs
  (`submit-for-review`/`approve`/`publish`) — exactly the sequence
  `test/catalog.e2e-spec.ts` already exercises end to end.
- A storefront product-listing/detail integration against
  `GET /catalog/products` (filterable/sortable/paginated) and
  `GET /catalog/products/:slug` (the full page aggregate — brand, category,
  every variant's SKU + price, all media — in one response).
- Category/brand/collection browse pages against their own `GET
/catalog/...` list+detail endpoints.

## Search

Postgres-only this pass — see ADR-005 decision 5 and the module README's
"Search" section. `ProductRepositoryPort.list`'s filter shape (brand,
category, collection, status, productType, tags, free-text search, sort) is
the seam a future dedicated search engine sits behind without the
application layer's contract changing.
