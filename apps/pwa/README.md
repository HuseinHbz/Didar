# @iecp/pwa

The installable, offline-capable PWA shell — client #3 in
`docs/product/blueprint.md` §1 ("نسخه 3: iPhone Web App / PWA"): Safari on iPhone
has no App Store distribution for a native app here, so this is the primary iPhone
client, designed to feel app-like via:

- **Installable** — `src/app/manifest.ts` (dynamic Web App Manifest) +
  `appleWebApp` metadata in the root layout for iOS "Add to Home Screen".
- **Offline cache** — [Serwist](https://serwist.pages.dev) (`src/app/sw.ts`),
  the actively-maintained successor to `next-pwa`. Service worker generation is
  **disabled in dev** (`next.config.ts`) since a caching SW fighting hot reload is
  more confusing than helpful locally; it only builds in production.
- **Camera / Virtual Try-On, location, push** — not implemented yet, tracked with
  the rest of the feature roadmap in the blueprint.

Payment, inventory, and order-status data is deliberately **excluded** from any
cache-first runtime caching route (blueprint §72) — see the comment in `sw.ts`.

## Relationship to `apps/storefront`

Same backend, same `@iecp/ui` tokens, different delivery shape: `storefront` is the
desktop-first SSR site, `pwa` is the mobile-first installable shell. See
`apps/storefront/README.md` and `docs/architecture/README.md` for the open question
of whether these should eventually merge into one app.

## Commands

```bash
pnpm --filter @iecp/pwa dev      # http://localhost:3002 (service worker disabled)
pnpm --filter @iecp/pwa build    # generates public/sw.js
pnpm --filter @iecp/pwa lint
pnpm --filter @iecp/pwa typecheck
```
