# @iecp/types

Shared, framework-agnostic TypeScript types used by every app and service:

- **`ids.ts`** — branded UUID types per aggregate (`CustomerId`, `OrderId`, …) so IDs
  from different entities can't be mixed up at compile time.
- **`money.ts`** — the `Money` value object. Integer Rial amount (`bigint`) internally,
  formats to Toman for display. No floats, ever (blueprint §90).
- **`enums.ts`** — cross-cutting enums that are architecture decisions, not
  admin-editable content: order status machine, inventory ledger transaction types,
  notification channels.
- **`result.ts`** — a small `Result<T, E>` type for typed, expected failures.

## What does _not_ live here

Anything that's admin-editable business content — products, categories, prices,
promotions, CMS pages/menus/banners — is **not** modeled as static TypeScript here.
Those are rows in PostgreSQL, reached through the API (see root `CLAUDE.md` and
`docs/product/blueprint.md` §4). This package is for structural/domain types only.

The full entity model (Product, Order, Prescription, …) lands here once the Phase 1
ERD work is done — see `docs/product/blueprint.md`, "وضعیت فعلی" section, and
`docs/database/`.

## Build

```
pnpm --filter @iecp/types build
```
