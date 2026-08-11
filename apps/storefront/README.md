# @iecp/storefront

The customer-facing storefront — Next.js 16 App Router, React 19, TypeScript strict.
This is client #1 of the three described in `docs/product/blueprint.md` §1 ("نسخه
1: Web App").

## Scope (target, not yet built)

Public storefront: catalog browsing, product detail, cart, checkout, account,
3D/virtual try-on, lens configuration, prescription upload, store locator, loyalty —
see the blueprint for the full feature list. Nothing beyond a placeholder home page
exists yet; this app currently only proves the monorepo wiring (shared `@iecp/ui`,
`@iecp/types`, `@iecp/validation` packages, Tailwind v4 token pipeline, React Query).

## Non-negotiable

No product/category/price/promotion/menu/content data is ever hardcoded here — see
root `CLAUDE.md`. Everything comes from `services/api`.

## Relationship to `apps/pwa`

Both `storefront` and `pwa` are customer-facing Next.js apps sharing the same
backend and the same `@iecp/ui` design tokens. `pwa` additionally ships a service
worker / installable-app-shell layer (offline cache, install prompt, iOS Safari
"Add to Home Screen" experience — blueprint §1, "نسخه 3: iPhone Web App / PWA");
`storefront` is the desktop-first, SSR-heavy responsive site. Whether these
ultimately stay two apps or collapse into one Next.js app with a PWA layer is an
open question — see `docs/architecture/README.md`.

## Commands

```bash
pnpm --filter @iecp/storefront dev      # http://localhost:3000
pnpm --filter @iecp/storefront build
pnpm --filter @iecp/storefront lint
pnpm --filter @iecp/storefront typecheck
```
