# Architecture

Full context: [`docs/product/blueprint.md`](../product/blueprint.md). This document
covers what's actually been decided and built in the monorepo scaffold itself —
read it alongside root [`CLAUDE.md`](../../CLAUDE.md), which is the condensed
version.

## System shape

```
                    ┌─────────────────────┐
                    │      CDN / WAF      │   (not set up yet)
                    └──────────┬──────────┘
                               │
                 ┌─────────────┼─────────────┬─────────────┐
                 │             │             │             │
          storefront        admin           pwa          mobile
          (Next.js)       (Next.js)      (Next.js+SW)    (Flutter)
                 │             │             │             │
                 └─────────────┴──────┬──────┴─────────────┘
                                      │
                              services/api (NestJS)
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
              services/worker  notification-worker  services/scheduler
              (BullMQ jobs)    (multi-channel notif) (cron)
                    │                 │                 │
                    └─────────────────┼─────────────────┘
                                      │
                              packages/database (Prisma)
                                      │
                                 PostgreSQL
                                      │
                        ┌─────────────┼─────────────┐
                        │             │             │
                     Redis       Object Storage   OpenSearch
                   (cache/queue)   (not wired)    (not wired)
```

Every client talks to `services/api` — no client ever queries PostgreSQL directly,
and no client hardcodes business/content data (root `CLAUDE.md`).

## Monorepo tooling

- **pnpm workspaces + Turborepo** — chosen for consistency with the sibling
  `lovely` project (same org, same `pnpm@10.33.0`), and because a mixed
  Next.js + NestJS + Flutter repo needs a real task graph
  (`turbo.json`: `build`/`dev` depend on `^build` so shared packages compile
  before their consumers).
- **Shared packages are pre-built**, not consumed as raw TS source
  (`packages/{types,validation,database,ui}` each ship a `tsup` build to `dist/`).
  This is more moving parts than "just-in-time" TS workspace packages, but it's
  the one approach that works cleanly for _both_ a bundler-based consumer
  (Next.js) and a `tsc`-based one (NestJS) without fragile path-mapping tricks.
- **TypeScript is pinned to 5.9.3**, not "latest" (which is a 7.x line under active
  rewrite) — `@typescript-eslint` only supports `<6.1.0` as of this writing. Revisit
  once the ESLint/Nest tooling ecosystem catches up.

## Backend: domain-based modules, clean-architecture layering

`services/api/src/modules/<domain>/`, one per business domain (blueprint §2). Inside
each module: `domain/ → application/ → infrastructure/` + `presentation/`, dependency
direction always inward toward `domain/`. See
`services/api/src/modules/identity/README.md` for the concrete, working example —
it's the template every future domain module should copy.

Twelve phases in: `health`, `identity`, `catalog`, `inventory`,
`cart-checkout`, `payment`, `order` (order/invoice/fulfillment/shipment),
`promotion`, and `return` (returns/refunds/credit notes) are all real,
each with its own short architecture doc —
[`identity`](../security/README.md) is covered by the security doc set;
[`catalog.md`](catalog.md), [`inventory.md`](inventory.md),
[`cart-checkout.md`](cart-checkout.md), [`payment.md`](payment.md),
[`order.md`](order.md), [`promotion-engine.md`](promotion-engine.md), and
[`returns.md`](returns.md) cover the rest. Everything else in blueprint
§2's domain list lands once its slice of the ERD is designed.

## Four backend services, not one

| Service                        | Entry point                          | Why separate                                                                                                                                                           |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/api`                 | HTTP (`NestFactory.create`)          | The only thing clients talk to.                                                                                                                                        |
| `services/worker`              | No HTTP (`createApplicationContext`) | Generic background jobs (image processing, PDF, search indexing) — must never block a request.                                                                         |
| `services/notification-worker` | No HTTP                              | Multi-channel notification fan-out with adapter-per-channel + SMS fallback (blueprint §41) — isolated so a notification-provider outage can't affect order processing. |
| `services/scheduler`           | No HTTP                              | Cron-driven (blueprint §69/§128), not queue-driven — a different trigger model from the other two.                                                                     |

## Open question: `apps/storefront` vs `apps/pwa`

The original blueprint (§1) frames Web and PWA as _one_ client ("نسخه 1: Web App"
already includes a PWA checkbox). The Phase 001 task brief lists `storefront` and
`pwa` as two separate `apps/*` entries instead. This scaffold built them as two
apps — `storefront` desktop-first/SSR, `pwa` mobile-first/installable/offline
(Serwist service worker) — sharing the same `@iecp/ui` tokens and backend, because
that's what was asked for. Whether they should eventually merge into one Next.js
app with a PWA layer, or genuinely stay separate (different caching/performance
tradeoffs for desktop vs. installed-mobile), is not resolved. Revisit before either
app grows far enough that a merge becomes expensive.

## Import style differs by module system — on purpose

`packages/*` (built via tsup, ESM+CJS dual output) and the Next.js apps
(`moduleResolution: Bundler`) use `.js`-suffixed relative imports
(`import { x } from './foo.js'`) — the modern TS/ESM convention, where the
specifier names the compiled output extension even though the source is `.ts`.

The four `services/*` (NestJS, `module: CommonJS`, `moduleResolution: Node10`)
use plain extensionless relative imports (`from './foo'`) instead. This isn't
inconsistency — `ts-jest` (CommonJS mode) doesn't remap `.js`-suffixed
specifiers back to their `.ts` source files, so `.js`-suffixed imports broke
every Nest service's Jest suite outright (`Cannot find module './foo.js'`)
until this was standardized per-module-system. If you add a new relative
import in `services/*`, leave off the extension; everywhere else, keep it.

## Non-negotiables (enforced, not just documented)

- **No business-critical data hardcoded in frontend** — `@typescript-eslint`
  strict rules catch `any`, but this one is a code-review discipline, not a lint
  rule. PostgreSQL via `services/api` is the only source of truth (blueprint §4).
- **No `any`** — `@iecp/eslint-config/base` hard-errors on
  `@typescript-eslint/no-explicit-any` and all `no-unsafe-*` rules; `@iecp/tsconfig`
  has `strict: true` plus `noUncheckedIndexedAccess`. See
  `packages/eslint-config/README.md`.
- **Every module documented** — every `apps/*`, `services/*`, `packages/*`
  directory has its own `README.md`. This document doesn't repeat their content.
