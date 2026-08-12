# modules/catalog

Phase 005's clean-architecture module for the product catalog and
merchandising domain — brands, categories, collections, products,
variants/SKUs, admin-defined attributes, media, and pricing. Same layering
convention `modules/identity` established (see that module's own README for
the full explanation of the pattern):

```
catalog/
├── domain/
│   ├── entities/    — plain TS classes: Brand, Category, Collection, Product,
│   │                  ProductVariant, ProductSku, Media, ProductMedia,
│   │                  ProductAttribute, ProductAttributeValue, ProductPrice,
│   │                  PriceHistoryEntry. No Prisma/NestJS dependency.
│   ├── ports/       — one repository interface (+ DI Symbol) per entity.
│   └── services/    — pure business logic, zero I/O, unit-tested without a
│                      database (see each spec file):
│                        SlugGenerator             — Persian-first slug derivation
│                        ProductLifecycleStateMachine — the 6-state publish graph
│                        PriceValidator             — money-integrity rules
│                        CategoryHierarchyService    — cycle detection + depth
│                        CollectionRuleEvaluator      — the dynamic-collection filter shape
│                        AttributeValueValidator      — variant<->attribute assignment guards
├── application/     — one service per entity (see "Application layer
│                      granularity" below), plus CatalogQueryService for the
│                      storefront read surface.
├── infrastructure/
│   ├── repositories/ — one Prisma-backed implementation per port.
│   ├── json.util.ts   — casts Prisma `Json?` columns to/from the typed shapes
│   │                    in @iecp/types (LocalizedText/SeoMetadata/CollectionRules).
│   └── pagination.util.ts — shared base64url cursor helper (generalizes
│                             identity's audit-log cursor to any orderable field).
└── presentation/
    ├── controllers/  — 8 admin controllers (under /admin/catalog/*) +
    │                   1 storefront controller (/catalog/*, all @Public()).
    ├── dto/           — request/response DTOs, class-validator + @nestjs/swagger.
    └── filters/       — CatalogDomainExceptionFilter (see its own doc comment).
```

Dependency direction is one-way: `presentation → application → domain ← infrastructure`,
verified the same way identity's is — `domain/services/*.spec.ts` unit-tests
the pure logic with zero DB, zero NestJS test module, zero mocks.

## Application layer granularity — a deliberate difference from identity

`modules/identity` uses one use-case class per action (`CreateRoleUseCase`,
`UpdateRoleUseCase`, ...). This module uses one **application service** per
entity (`BrandsService`, `ProductsService`, ...) exposing several methods
each. Both are legitimate clean-architecture shapes — the layering and the
domain/infrastructure boundary are identical either way. This module picked
the coarser one deliberately, for file-count tractability given its size
(10 entities × full CRUD + lifecycle + bulk operations), not because the
finer-grained convention was wrong. Every method still: validates through
the domain layer first, depends only on repository ports (never Prisma
directly), and is independently unit-testable by mocking those ports.

## What's actually implemented (Phase 005)

### Brands, categories, collections

Standard CRUD (`BrandsService`/`CategoriesService`/`CollectionsService`) —
slug derivation + uniqueness probing (`SlugGenerator`), delete guarded by
"is this still referenced" checks (`hasProducts`/`hasChildren`). Categories
nest to unlimited depth (self-referencing `parentId`, cycle-checked by
`CategoryHierarchyService.wouldCreateCycle` the same way identity's `Role`
tree is, but as a pure in-memory function over an already-loaded snapshot
rather than a per-step SQL walk — see that service's own doc comment).
Collections are `MANUAL` (explicit `CollectionProduct` membership, admin
sort order) or `DYNAMIC` (a narrow, fixed rule shape — brand/category/tags/
gender/productType — evaluated by `CollectionRuleEvaluator`; see
`docs/adr/ADR-005-catalog-architecture.md` decision 4 for why this isn't a
general rule engine).

### Products — the full publication lifecycle

`ProductsService` enforces `DRAFT → IN_REVIEW → APPROVED → PUBLISHED →
UNPUBLISHED`, with `ARCHIVED` reachable (and terminal) from any
non-archived state — `ProductLifecycleStateMachine.assertTransition` runs
before any status write; an illegal transition (e.g. publishing a DRAFT
directly) is a `409`, not silently allowed or a `500` (see
`CatalogDomainExceptionFilter`). Every transition that changes what's
publicly visible (`publish`/`unpublish`/`archive`, plus `delete`) writes a
`system.AuditLog` row — the first real writer of that table in this repo
(Phase 004 built the read side, `GET /audit-log`, but no identity use case
ever actually wrote to it). `bulkPublish`/`bulkArchive` run sequentially and
report per-item success/failure rather than aborting the whole batch on the
first error.

### Variant vs. SKU

See `docs/adr/ADR-005-catalog-architecture.md` decision 1 for the full
rationale. In short: a `ProductVariant` is a merchandising configuration
(color, size, frame/lens measurements — what an admin picks when authoring
a product); a `ProductSku` is the commerce unit (SKU code, barcode, cost/
weight/dimensions, tax rate, supplier ref) that inventory and pricing key
off. Exactly one SKU per variant (`variantId` unique) — a variant can exist
without a SKU yet (mid-authoring), never the reverse.

### Pricing

`PricingService.setPrice` validates through `PriceValidator` (positive
`basePrice`, `compareAtPrice` strictly greater, non-negative cost, a valid
scheduling window, tax rate in [0, 10000] basis points), then writes
**both** `finance.PriceHistory` (via `PricingRepositoryPort.setPrice`, in
the same transaction as the `ProductPrice` upsert — blueprint §13's
append-only trail) **and** a `system.AuditLog` `PRODUCT_PRICE_CHANGED` row
— the two serve different audiences, see that service's own doc comment.
Money travels over HTTP as decimal strings, never JSON numbers (`bigint`
has no native JSON form).

### Media

Storage-agnostic (`provider`/`storageKey`/`url` — see ADR-005 decision 3):
no upload endpoint this pass, `register` takes an already-hosted URL, the
same limitation `ProductImage.url` had in Phase 003. `PRIMARY`-role
exclusivity per product/variant scope is enforced in `MediaService`, not a
DB constraint (no partial unique index this pass — see
`ProductMediaRepositoryPort`'s own doc comment).

### Admin-defined attributes

The EAV tables Phase 003 already built (`ProductAttribute`/
`ProductAttributeValue`), now localizable and filterable-flagged, for
open-ended tags the fixed `ProductVariant` columns don't cover.
`AttributesService.assignToVariant` rejects assigning the same attribute
twice to one variant (`AttributeValueValidator.assertNoDuplicateAttributes`).

### Storefront (`CatalogQueryService`)

Every method enforces its own "actually publicly visible" filter
(`status = PUBLISHED`, `deletedAt = null` for products; `status = ACTIVE`
for brands; `isPublished` for categories; `isWithinWindow(now)` for
collections) rather than trusting the caller to remember it — proven
directly in `test/catalog.e2e-spec.ts`: the seed's own DRAFT product never
appears in a storefront listing or by direct slug lookup. `getProductDetail`
returns the full page aggregate (product + brand + category + every
variant's SKU + price + all product media) in one response — no
client-side N+1 fan-out.

### Search

Postgres-only this pass (`ILIKE` + B-tree indexes on
`brandId`/`categoryId`/`status`/`productType`) — deliberately not
Elasticsearch/OpenSearch, per the brief's own "don't over-build" instruction
and ADR-005 decision 5. `ProductRepositoryPort.list`'s filter shape is the
seam a future dedicated search engine would sit behind without changing the
application layer's contract.

## Deliberately out of scope for this pass

- **No Next.js admin/storefront pages.** `apps/admin`/`apps/storefront` are
  untouched, following the exact precedent Phase 004 set for identity — see
  `docs/adr/ADR-005-catalog-architecture.md` decision 7 and
  `docs/product/catalog.md` for the reasoning and what a future frontend
  phase would need from this API surface.
- **No object storage integration** behind the `Media` abstraction.
- **No dedicated search engine.**
- **No two-person four-eyes approval** — the lifecycle has a single-approver
  review gate (`IN_REVIEW → APPROVED`), not a second, independent approver.
- **No checkout discount/coupon calculation** — this phase only stores the
  pricing foundation (`basePrice`/`compareAtPrice`/scheduling window) a
  future commerce phase reads.
- **No multi-SKU-per-variant, no multi-category-per-product.**
- **Not every conceivable sub-resource action has its own endpoint** —
  variants/SKUs/media/attributes/pricing get real, tested CRUD sufficient to
  drive the full create→publish workflow (see `test/catalog.e2e-spec.ts`),
  not exhaustive parity with every possible admin UI affordance a full
  frontend might eventually want.

Full list with reasoning: `docs/adr/ADR-005-catalog-architecture.md`'s
"Deferred" section.

## Testing

```bash
pnpm --filter @iecp/api test        # unit — 6 domain-service spec files, no DB
pnpm --filter @iecp/api test:e2e    # e2e — requires a migrated + seeded DATABASE_URL
```

`domain/services/*.spec.ts` are the fast, DB-free proofs of the lifecycle
state machine, price validation, category cycle detection, the dynamic-
collection rule shape, attribute-assignment guards, and slug derivation.
`test/catalog.e2e-spec.ts` is the full-stack proof against a real Postgres:
unauthorized/permission-denied access, the full create→publish workflow
(including an illegal-transition 409), storefront visibility (including
the seed's DRAFT product staying invisible), archive, and bulk operations
— logging in as the seed's real `admin`/`catalog_editor` fixture users via
the real OTP flow, not fabricated tokens.

## Config

No catalog-specific env vars this pass — it reuses `services/api`'s
existing `DATABASE_URL`/identity JWT config wholesale (every admin route
sits behind the same global `JwtAuthGuard`/`AuthorizationGuard` Phase 004
installed).
