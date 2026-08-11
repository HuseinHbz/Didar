## What

<!-- One or two sentences: what does this PR do? -->

## Why

<!-- Link the blueprint section / issue / decision this implements, if any. -->

## Scope

- [ ] Touches: `apps/…` / `services/…` / `packages/…` / `infrastructure/…` / `docs/…`
- [ ] Adds/changes a database model (`packages/database/prisma/schema.prisma`)
- [ ] Adds/changes an API endpoint

## Checklist

- [ ] `pnpm validate:structure && pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass locally
- [ ] No `any` introduced (CI's `pnpm lint` will catch this, but check before pushing)
- [ ] No business-critical data hardcoded in frontend code (`apps/*`) — see `CLAUDE.md`
- [ ] New/changed module has a `README.md`
- [ ] New domain module in `services/*` follows the clean-architecture layering
      (`domain/ → application/ → infrastructure/` + `presentation/`) —
      see `services/api/src/modules/identity/README.md`
- [ ] Tests added/updated for new logic

## Notes for reviewers

<!-- Anything non-obvious, tradeoffs made, follow-up work intentionally deferred. -->
