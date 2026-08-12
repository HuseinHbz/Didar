# Product Catalog & Merchandising — Phase 005 scope

Full architectural rationale: [`docs/adr/ADR-005-catalog-architecture.md`](../adr/ADR-005-catalog-architecture.md).
Full endpoint/permission reference:
[`docs/api/catalog.md`](../api/catalog.md) /
[`docs/security/catalog-security.md`](../security/catalog-security.md).
Business/product framing this phase implements: `docs/product/blueprint.md`
§7-§13. This document says what's real **today** versus still aspirational —
same convention as `docs/security/README.md`.

## What this phase is

The production-grade product catalog domain for the optical storefront:
brands, hierarchical categories, manual/dynamic collections, products with a
publishing lifecycle, variants (merchandising configuration) split from SKUs
(the sellable/priced/inventoried unit), admin-defined attributes, a
storage-agnostic media abstraction, and scheduled pricing with an audit
trail — all reachable only through `services/api`'s REST endpoints, backed by
PostgreSQL as the single source of truth (root `CLAUDE.md`'s non-negotiable
rule). No client — admin, storefront, PWA, mobile — ever queries the
database directly, and no product/price/category data is ever hardcoded in
frontend code.

## Domain model at a glance

```
Brand ──┐
        │
Category (self-referencing tree) ──┐
                                    │
Collection (manual | dynamic) ──┐  │
                                 │  │
                    Product ◄───┴──┘   (brand, category, status: DRAFT → IN_REVIEW
                       │                → APPROVED → PUBLISHED → UNPUBLISHED/ARCHIVED)
                       │
                 ProductVariant       (color, size, frame/lens measurements —
                       │               a merchandising configuration)
                       │  1:1 (optional until commerce-ready)
                  ProductSku          (skuCode, barcode, cost, weight/dims,
                       │               tax, supplier — the sellable unit)
              ┌────────┼────────┐
        ProductPrice  InventoryItem  (finance / inventory schemas —
       (+PriceHistory) (+ledger)      keyed off productSkuId, not the variant)

Product ──< ProductMedia >── Media   (provider-abstracted: LOCAL | S3 | CDN)
Product ──< CollectionProduct >── Collection   (manual membership + sort order)
ProductVariant ──< ProductVariantAttributeValue >── ProductAttributeValue ── ProductAttribute
```

See `docs/database/catalog-erd.md` for the full Mermaid ERD with every column.

## What's real (Phase 005)

- **Brand/Category/Collection CRUD** with slugs, localized names
  (`{fa, en}`), SEO metadata, sort order, active/inactive status. Categories
  nest to unlimited depth (self-referencing `parentId`, cycle-checked the
  same way Phase 004's `Role` tree is).
- **Product publishing lifecycle** — a real state machine
  (`ProductLifecycleStateMachine`, pure domain service, unit-tested), not a
  bare status column: `DRAFT → IN_REVIEW → APPROVED → PUBLISHED`, with
  `PUBLISHED → UNPUBLISHED` and any state `→ ARCHIVED`. Illegal transitions
  (e.g. publishing a `DRAFT` directly) are rejected before they reach the
  database.
- **Variant vs. SKU** — see ADR-005 decision 1 for why they're split. A
  variant carries the optical/merchandising attributes (color, size, frame
  width, bridge width, temple length, lens width, fit, gender, shape,
  material, style, lens compatibility tags); its SKU carries the commerce
  facts (SKU code, barcode, cost, weight, dimensions, tax rate, supplier
  reference) plus the price/inventory rows that key off it.
- **Pricing foundation** — base price, compare-at price, a validity window
  (scheduled pricing), and an append-only `PriceHistory` audit trail. No
  checkout-time discount/coupon math (deliberately deferred, see ADR-005).
- **Media abstraction** — `Media` rows are provider-tagged
  (`LOCAL`/`S3`/`CDN`) and kind-tagged (`IMAGE`/`VIDEO`/`MODEL_3D`/
  `AR_ASSET`), attached to a product (and optionally one of its variants)
  through `ProductMedia` with a role (`PRIMARY`/`GALLERY`/`THUMBNAIL`/
  `SWATCH`/`VIDEO`/`MODEL_3D`) and sort order. `Product.arModelMediaId` +
  `Product.faceTryOnMetadata` are AR-readiness fields — schema only, no AR
  engine.
- **Admin-defined attributes** stay on the existing EAV tables from Phase
  003 (`ProductAttribute`/`ProductAttributeValue`), now filterable and
  localizable, for open-ended tags the fixed variant columns don't cover.
- **Search foundation** — Postgres-only (ILIKE + indexes on name/SKU/
  barcode/brand/category), explicitly not Elasticsearch/OpenSearch (brief's
  own instruction not to over-build). See ADR-005 decision 5 for the seam
  a future dedicated search engine would replace.
- **RBAC + audit reuse** — every admin write sits behind Phase 004's
  `JwtAuthGuard`/`AuthorizationGuard` with a real registered permission
  (`catalog.products.publish`, etc.); every sensitive mutation writes a
  `system.AuditLog` row. No parallel authorization or audit system.
- **Admin + storefront REST APIs**, both real, both tested — see
  `docs/api/catalog.md` for the full endpoint table.

## What's explicitly not real yet

- **No Next.js admin/storefront pages.** `apps/admin` and `apps/storefront`
  are untouched — same precedent Phase 004 set for identity/RBAC. The API
  surface this phase ships is what a future frontend phase integrates
  against; see `docs/architecture/catalog.md`'s "Deferred" section for
  exactly what that phase would need to build.
- **No object storage integration.** `Media.storageKey`/`url` are accepted
  and stored; nothing uploads bytes to S3/a CDN yet — same limitation
  `ProductImage.url` had in Phase 003.
- **No dedicated search engine**, **no four-eyes approval** (single-approver
  review gate only), **no checkout discount/coupon calculation**, **no
  multi-SKU-per-variant or multi-category-per-product**, **no full lens
  configuration engine**. Full list with reasoning: ADR-005 "Deferred".

Treat anything not explicitly listed above as "not built" — don't assume a
blueprint §7-§13 feature exists just because this file or the blueprint
mentions it.
