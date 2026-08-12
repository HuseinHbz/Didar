# ADR-005: Catalog & Merchandising Architecture

- **Status**: Accepted
- **Phase**: 005 — Enterprise Product Catalog, Product Management & Merchandising
- **Depends on**: Phase 003 (`docs/database/README.md`), Phase 004
  (`services/api/src/modules/identity/README.md`)

## Context

Phase 003 shipped a _foundation_ catalog schema — `Brand`, `Category`,
`Product`, `ProductVariant` (which doubled as the sellable/priced unit),
`ProductAttribute`/`ProductAttributeValue`, `ProductImage`, plus pricing
(`finance.ProductPrice`/`PriceHistory`) and inventory
(`inventory.InventoryItem`) keyed off `productVariantId`. It was explicitly
scoped as a skeleton: "primary entities... not full coverage" (see that
file's header comment).

Phase 005's brief asks for a materially richer model: brands with SEO and
localized names, unlimited-depth categories with a separate active/published
distinction, manual **and** rule-based dynamic collections, a product
publishing state machine (`DRAFT → IN_REVIEW → APPROVED → PUBLISHED →
UNPUBLISHED/ARCHIVED`), a _SKU_ concept distinct from a _variant_, a storage-
agnostic media abstraction, AR/3D readiness, scheduled/compare-at pricing
with an audit trail, and both admin and storefront APIs — all while reusing
Phase 004's RBAC/audit machinery rather than inventing a parallel one.

## Decisions

### 1. Variant vs. SKU are two different entities, not one

The Phase 003 schema conflated "one purchasable configuration of a product"
(a variant: a specific color/size/frame-measurement combination) with "the
thing that has a barcode, a cost, a price, and inventory" (a SKU). Real
eyewear catalogs need both: a _variant_ is a merchandising concept (what an
admin picks when authoring a product — "Matte Black, 52mm"), while a _SKU_ is
a commerce/inventory concept (what has a price, a supplier, a weight, and a
stock ledger row). Splitting them:

- lets `ProductVariant` carry the fixed optical measurement fields the brief
  asks for (`frameWidth`, `bridgeWidth`, `templeLength`, `lensWidth`, `fit`,
  `gender`, `frameShape`, `frameMaterial`, `style`, `lensCompatibility`)
  without those columns being commerce-irrelevant noise on the sellable row,
  and without commerce fields (`costPrice`, `barcode`, `taxRateBasisPoints`)
  polluting the merchandising row;
- matches the brief's own vocabulary exactly (`sku.requirements` lists
  "Variant relation" as a SKU field, i.e. SKU depends on Variant, not the
  reverse);
- keeps the door open for a variant to exist in a draft state (admin has
  picked "Matte Black, 52mm" as a configuration) before a SKU (barcode, cost,
  price) has been assigned — which is exactly the two-step order the brief's
  `admin_workflows.product_creation` describes ("Create variants" then
  "Create SKUs").

The relation is 1:1 (`ProductSku.variantId` is unique) for this pass — one
sellable unit per variant, not variant-as-parent-of-many-SKUs (e.g. per
supplier or per warehouse-specific barcode). That's a real limitation, not an
oversight; see "Deferred" below.

**Consequence**: `InventoryItem`, `CartItem`, and `OrderItem` — previously
keyed off `productVariantId` — are repointed to `productSkuId`, since the SKU
is what actually has stock, a price, and a snapshot-able name at order time.
This is a breaking change to three tables outside the `catalog` schema,
migrated in the same migration as the rest of Phase 005 (see
`docs/database/catalog-erd.md`).

### 2. Pricing stays in `finance`, extended in place

Phase 003 already put `ProductPrice`/`PriceHistory` in the `finance` schema
specifically so pricing would be "its own domain, not a bare column on
Product" (that model's own doc comment). Phase 005 keeps that call and
extends it rather than duplicating a second pricing table inside `catalog`:
`ProductPrice` gains `compareAtPrice`, `validFrom`/`validTo` (the "scheduled
pricing" / "price validity period" requirements), and its FK moves from
`productVariantId` to `productSkuId` per decision 1. `PriceHistory` already
covered the audit-trail requirement and needs no shape change beyond the
same FK rename.

Coupon/discount _calculation_ at checkout is explicitly out of scope per the
brief's own `pricing.important` note — this phase only stores the price
foundation a future commerce phase reads.

### 3. SEO and AR-readiness are typed JSON columns, not new tables

`seo` (title, meta description, canonical URL, OG image, noindex,
structured-data type) is genuinely optional, sparse, and per-locale — a
faithful relational model would need a join table per locale per entity for
four entity types, for a foundation pass with no consumer reading it yet
beyond the API surface this phase ships. It's modeled as a `Json?` column
(`seo`) on `Brand`/`Category`/`Collection`/`Product`, validated at the
application boundary by a shared `SeoMetadata` shape (`packages/types`), the
same pattern already used for `Order.shippingAddressSnapshot`. The same
reasoning applies to `Product.faceTryOnMetadata` (AR try-on calibration —
schema-ready, no AR engine behind it) and localized names/descriptions
(`localizedName`/`localizedAltText`: `{ "fa": "...", "en": "..." }`).

A dedicated `Media` model (`catalog.media`) is the one non-JSON abstraction
this phase adds: `provider` (`LOCAL | S3 | CDN`) + `storageKey` + `url`, so
the catalog domain never imports a specific object-storage SDK — swapping
providers later is a new `MediaProvider` value and a new
`infrastructure/storage/` adapter, not a schema or domain change.
`Product.arModelMediaId` points at a `Media` row of kind `MODEL_3D`/
`AR_ASSET` — schema-ready for a future AR engine, per the brief's explicit
"do not implement a full AR engine" instruction.

### 4. Dynamic collections get a JSON rule bag + an in-process evaluator, not a rule engine

`Collection.type = DYNAMIC` stores its membership rule as `rules Json?`
(`{ brandId?, categoryId?, tags?, gender?, productType? }` — an explicit,
narrow shape, not an arbitrary expression AST) and membership is computed at
query time by `CollectionRuleEvaluator`, a pure domain function translating
that shape into repository-level filter criteria. `MANUAL` collections use an
explicit join table (`CollectionProduct`) with an admin-controlled sort
order. This satisfies "rules-based collections" without building a general
rule engine the brief explicitly warns against over-building
(`search.do_not_overbuild` applies to the same spirit here).

### 5. Search stays inside PostgreSQL

Per `search.do_not_overbuild`: no OpenSearch/Elasticsearch in this phase.
Product/SKU/barcode/brand/category search and attribute filtering are plain
indexed Postgres queries (`ILIKE`/trigram-friendly indexes on `name`,
`skuCode`, `barcode`; B-tree indexes on `brandId`/`categoryId`/`status`).
The application layer's `CatalogSearchQuery` use case is the seam a future
dedicated search engine would replace — its contract (input filters, output
shape) doesn't change if the implementation behind it later calls
OpenSearch instead of Prisma.

### 6. RBAC and audit are reused, not reinvented

Every admin write endpoint sits behind Phase 004's `JwtAuthGuard` +
`AuthorizationGuard` (`@RequirePermission('catalog.products.publish')`, etc.)
— see `docs/security/catalog-security.md` for the full permission list.
Every sensitive mutation (publish, bulk price update, bulk archive, brand
delete) writes a `system.AuditLog` row via the same audit-log write path
Phase 004 established, rather than a catalog-specific audit table. Four-eyes
approval workflows (`blueprint §57-§58`) are **not** built here — the brief's
`admin_workflows.product_creation` already models a review step
(`IN_REVIEW → APPROVED`) as a single-approver gate; a true two-person
four-eyes rule is future scope (see "Deferred").

### 7. Backend-only this pass — no Next.js admin/storefront pages

Phase 004 set the precedent: a full clean-architecture backend module with
zero frontend pages, `apps/admin` and `apps/storefront` untouched. Phase 005
follows the same split deliberately, not as an oversight: the brief's
`admin`/`storefront` deliverable lists ("Product management", "Bulk
operations", "Product listing API integration", etc.) are implemented as
real, tested, RBAC-guarded REST endpoints under `/admin/catalog/*` and
`/catalog/*` — the actual "must never hardcode business data in frontend
code" rule this project leads with is a statement about where data _can_
come from, not a requirement that the UI ships in the same phase as the API
it will call. Building `apps/admin`'s catalog screens now, without a design
system pass or the rest of the admin shell, would be exactly the kind of
"anemic," un-reviewed UI work the project's own quality bar warns against.
See `docs/architecture/catalog.md`'s "Deferred" section for the concrete
list of what a future frontend phase needs from this API surface.

## Deferred (explicitly out of scope for Phase 005)

- Next.js admin/storefront catalog pages (decision 7).
- Multi-SKU-per-variant (decision 1) and multi-category-per-product (a
  product has exactly one primary `categoryId`; cross-listing into multiple
  categories is a join table a future phase can add additively).
- A general dynamic-collection rule engine beyond the fixed filter shape in
  decision 4.
- OpenSearch/Elasticsearch-backed search (decision 5).
- A real object-storage integration behind the `Media` abstraction — `LOCAL`
  storage keys are accepted and stored today; nothing uploads bytes anywhere
  yet (no upload endpoint in this phase — media rows are created with an
  already-hosted URL, matching how `ProductImage.url` worked in Phase 003).
- Two-person four-eyes approval (decision 6) — the state machine has an
  `IN_REVIEW`/`APPROVED` gate with a single approver.
- Coupon/discount calculation at checkout (decision 2).
- Full lens configuration/compatibility engine (still deferred from Phase
  003 — `LensType`/`LensCoating` remain lookup tables only).

## Consequences

Positive: the domain model now matches the vocabulary of the brief exactly
(variant vs. SKU, lifecycle states, media abstraction), pricing/audit/RBAC
stay consistent with the conventions Phase 003/004 already established
instead of forking new ones, and every deferred item has a stated reason
tied to an explicit instruction in the brief rather than being silently
dropped.

Cost: this is a breaking schema change to three non-catalog tables
(`InventoryItem`, `CartItem`, `OrderItem`) and to `ProductPrice`/
`PriceHistory`'s FK — acceptable pre-`main` (nothing has shipped to
production, `develop` only just got Phase 003/004 merged into it), but any
phase after this one building on `productVariantId` in those tables would
have been building on the wrong key.
