# Catalog security (Phase 005)

This document is `docs/security/README.md`'s "In place today" table,
expanded for the one module Phase 005 added — the 21 `catalog.*`
permissions and the two roles that hold them. Read
[`README.md`](./README.md) first for what applies service-wide (rate
limiting, secrets, dependency scanning, ...); this document only covers
what's specific to the catalog domain.

No new auth mechanism was built for this module — every control below is
Phase 004's identity/RBAC infrastructure (`JwtAuthGuard`,
`AuthorizationGuard`, `PermissionResolver`, `system.AuditLog`), reused, not
reinvented (ADR-005 decision 6). If you're looking for how JWTs, sessions,
2FA, or the permission-resolution algorithm itself work, see
`services/api/src/modules/identity/README.md` and this document's parent —
this file is scope-limited to what catalog checks and why.

## Permission registry

All 21 registered in `packages/database/prisma/seed.ts`'s `permissionDefs`,
each namespaced `catalog.<action>` and checked via `@RequirePermission` on
exactly the controller method named. List endpoints use the coarser
`@RequireModule('catalog')` instead (any `catalog.*` permission is enough
to read) — see [`docs/api/catalog.md`](../api/catalog.md) for the full
endpoint-to-guard mapping.

| Permission                   | Enforced on                               | admin | catalog_editor |
| ---------------------------- | ----------------------------------------- | ----- | -------------- |
| `catalog.brands.create`      | `POST /admin/catalog/brands`              | ✅    | ✅             |
| `catalog.brands.update`      | `PATCH /admin/catalog/brands/:id`         | ✅    | ✅             |
| `catalog.brands.delete`      | `DELETE /admin/catalog/brands/:id`        | ✅    | ❌             |
| `catalog.categories.create`  | `POST /admin/catalog/categories`          | ✅    | ✅             |
| `catalog.categories.update`  | `PATCH`/`POST :id/publish` on categories  | ✅    | ✅             |
| `catalog.categories.delete`  | `DELETE /admin/catalog/categories/:id`    | ✅    | ❌             |
| `catalog.collections.create` | `POST /admin/catalog/collections`         | ✅    | ❌             |
| `catalog.collections.update` | `PATCH`/membership/reorder on collections | ✅    | ❌             |
| `catalog.collections.delete` | `DELETE /admin/catalog/collections/:id`   | ✅    | ❌             |
| `catalog.products.create`    | `POST /admin/catalog/products`            | ✅    | ✅             |
| `catalog.products.update`    | `PATCH` + `submit-for-review` on products | ✅    | ✅             |
| `catalog.products.delete`    | `DELETE /admin/catalog/products/:id`      | ✅    | ❌             |
| `catalog.products.approve`   | `approve`/`reject`                        | ✅    | ❌             |
| `catalog.products.publish`   | `publish`/`unpublish`                     | ✅    | ❌             |
| `catalog.products.archive`   | `archive`                                 | ✅    | ❌             |
| `catalog.products.bulk`      | `POST /admin/catalog/products/bulk`       | ✅    | ❌             |
| `catalog.variants.manage`    | variant CRUD                              | ✅    | ✅             |
| `catalog.skus.manage`        | SKU CRUD                                  | ✅    | ✅             |
| `catalog.media.manage`       | media register/attach/detach/reorder      | ✅    | ✅             |
| `catalog.attributes.manage`  | attribute/value CRUD + variant assignment | ✅    | ✅             |
| `catalog.pricing.manage`     | `PUT /admin/catalog/skus/:skuId/price`    | ✅    | ❌             |

`catalog_editor` is deliberately a **content-authoring** role: it can
create and edit brands/categories/products/variants/SKUs/media/attributes,
but holds none of `.delete`, `.approve`, `.publish`, `.archive`, `.bulk`,
or `.pricing.manage`. This isn't a hypothetical boundary — it's the exact
role the e2e suite logs in as to prove a permission-bypass attempt (e.g.
`POST .../publish`) actually 403s rather than merely "not being tested"
(`test/catalog.e2e-spec.ts`).

## Roles

| Role             | Grant                                                                                                                                                 | Seed user       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `admin`          | Every `catalog.*` permission (looped grant over `permissionDefs`, `module === 'catalog'`) — same role Phase 004 gave every `identity.*` permission to | `+989120000001` |
| `catalog_editor` | The 10-permission subset in the table above                                                                                                           | `+989120000004` |

`admin` is not catalog-specific — it's the same system role Phase 004
created, now additionally holding every catalog permission. There is no
separate "catalog admin" role this phase; the least-privilege boundary
that matters for catalog is `admin` vs. `catalog_editor`, not a third tier.

## What's proven, not just declared

- **Unauthenticated access is rejected.** Every `admin/catalog/*` route
  401s with no token — `JwtAuthGuard` is global, catalog registers no
  `@Public()` opt-out on any admin controller.
- **Under-privileged access is rejected.** `catalog_editor` calling
  `publish`/`archive`/`bulk`/`pricing` 403s — proven directly in
  `test/catalog.e2e-spec.ts`, not inferred from the permission table above.
- **Illegal state transitions are rejected**, distinctly from permission
  checks — even an `admin` publishing a `DRAFT` product directly (skipping
  `IN_REVIEW`/`APPROVED`) gets a 409 from `CatalogDomainExceptionFilter`,
  not a 200 that silently corrupts the lifecycle. This is a domain-layer
  guard (`ProductLifecycleStateMachine`), independent of RBAC — the two are
  layered, not substitutes for each other.
- **Storefront visibility is enforced server-side, not by convention.**
  `CatalogQueryService` filters `status = PUBLISHED` (products),
  `status = ACTIVE` (brands), `publishedAt` set (categories), and the
  active date window (collections) on every read — proven by the seed's
  own `DRAFT` product staying invisible to an unauthenticated storefront
  request.

## Audit logging

Catalog is the first real **writer** of `system.AuditLog` in this repo —
Phase 004 built the read side (`GET /audit-log`) but no identity use case
ever wrote a row. Every mutation that changes what's publicly visible, or
money, writes one:

| Action          | Audit event             |
| --------------- | ----------------------- |
| `approve`       | product approval        |
| `publish`       | product publish         |
| `unpublish`     | product unpublish       |
| `archive`       | product archive         |
| `delete`        | product delete          |
| `PUT .../price` | `PRODUCT_PRICE_CHANGED` |

Content edits (`PATCH` on brand/category/product, variant/SKU/media/
attribute CRUD) do **not** write an audit row — the bar applied is
"changes what's publicly visible or what money changes hands," matching
this repo's `system.AuditLog` design intent (`docs/database/README.md`
convention 3's "substantive who-changed-what record"), not every write.
Pricing additionally writes `finance.PriceHistory` in the same transaction
(the append-only commerce-facing trail) — the two records serve different
audiences: `PriceHistory` is "what was the price at time T," `AuditLog` is
"who changed it and when" (see `PricingService`'s own doc comment).

## Deliberately not built this phase

Same list as `services/api/src/modules/catalog/README.md`'s "Deliberately
out of scope," security-relevant subset:

- **No two-person four-eyes approval** on the `IN_REVIEW → APPROVED`
  transition — a single `catalog.products.approve` holder can approve
  their own submission. Blueprint §57-§58/§105's four-eyes workflow is
  still not started anywhere in this repo (see `docs/security/README.md`).
- **No field-level permission on catalog data** — Phase 004 built the
  mechanism (`identity.users.view_contact`, see that module's README) and
  proved it once; catalog doesn't reuse it for anything (no catalog field
  is sensitive enough to need it yet).
- **No rate limiting specific to catalog writes** — same blanket nginx
  `limit_req_zone` as everything else, see `docs/security/README.md`'s
  "Not yet" list.
- **No media upload endpoint** — `POST /admin/catalog/media` registers an
  already-hosted URL; there's no file-upload surface to worry about
  scanning/validating yet (ADR-005 decision 3, "Deferred").
