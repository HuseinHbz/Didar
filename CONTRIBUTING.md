# Contributing

This is an internal monorepo for the Didar / IECP project. These are the rules
the codebase is built to enforce — read `CLAUDE.md` first for the architecture
context, then this for how to actually work in the repo day to day.

## The five rules

These come directly from the project's foundation task and are treated as
non-negotiable, not style preferences:

1. **TypeScript strict mode.** Every `tsconfig.json` in the repo extends one of
   the bases in `packages/config` (`strict: true`, plus
   `noUncheckedIndexedAccess`, `noImplicitOverride`,
   `noPropertyAccessFromIndexSignature`, `noUnusedLocals`). Don't weaken these in
   a project-local `tsconfig.json` without an ADR explaining why.
2. **No `any`.** `@typescript-eslint/no-explicit-any` and every `no-unsafe-*` rule
   are hard errors in `packages/eslint-config/base.mjs`, which every workspace's
   `eslint.config.mjs` extends. If you're reaching for `any`, you want `unknown`
   + a type guard, a generic, or (rarely) a precise `as` assertion with a comment
   explaining why it's safe.
3. **No business-critical data hardcoded in frontend code.** No
   `const products = [...]`, no `const categories = [...]`, no
   `const menuItems = [...]` — anywhere in `apps/*`. Product, price, category,
   promotion, CMS content, menus, banners: all of it comes from `services/api`,
   which reads it from PostgreSQL. See `CLAUDE.md` for the full rule and its
   rationale. This one isn't lint-enforced — it's a code-review discipline.
4. **Every module has documentation.** Every directory under `apps/`, `services/`,
   `packages/`, and `infrastructure/` has its own `README.md`. Adding a new one?
   Add its `README.md` in the same PR, not as a follow-up.
5. **Clean architecture in `services/*`.** Each domain module is
   `domain/ → application/ → infrastructure/` + `presentation/`, dependency
   direction always inward. `domain/` never imports `@iecp/database` or anything
   NestJS-HTTP-specific. See `services/api/src/modules/identity/` for the
   worked example and its `README.md` for the rationale.

## Before you write a new domain module

Check `docs/product/blueprint.md` and `docs/database/README.md` first — most
domains (`catalog`, `order`, `inventory`, …) don't have a real database schema
yet (Phase 1 ERD work, not done). Building a full feature against a schema that's
about to be redesigned wastes the work. If you're not sure whether a domain's
schema is "real" yet, check `packages/database/prisma/schema.prisma` — if it's
not modeled there, it's not real yet.

## Workflow

- **Branches**: `feature/*`, `fix/*`, `hotfix/*`, `release/*` off `main`
  (blueprint §96).
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org) —
  `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `security:`.
- **Before opening a PR**, from the repo root:
  ```bash
  pnpm validate:structure   # repo layout sanity check
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  ```
  All of these also run in CI (`.github/workflows/ci.yml`) — a red CI check means
  don't merge, not "merge and fix later".
- **PRs**: use the template in `.github/pull_request_template.md`. Keep them
  scoped to one module/domain where possible — this repo has a lot of surface
  area, and a 40-file PR touching four unrelated domains is hard to review
  honestly.

## Testing expectations

- **Unit tests** for anything with real logic — see
  `services/api/src/modules/identity/application/get-user-by-id.usecase.spec.ts`
  and `services/notification-worker/src/notifications/notification-dispatcher.service.spec.ts`
  for the pattern: test against the port/interface with a hand-rolled fake, not
  a real database or a mocking framework fighting NestJS's DI container.
- **e2e tests** (`services/api/test/`) may require real infrastructure
  (`DATABASE_URL` reachable) — see each service's `README.md` for exact
  requirements.
- No repo-wide coverage threshold is enforced yet. Blueprint §98 targets
  >85% overall / >95% for payment, order, inventory, pricing, coupon, loyalty,
  auth once those domains exist — treat that as the bar once you're writing
  those modules, not before.

## Adding a shared package

Follow the shape of `packages/validation` or `packages/types` (the simplest two):
`package.json` with a `build` script (`tsup`), `tsconfig.json` extending
`@iecp/tsconfig/base.json`, `eslint.config.mjs` extending
`@iecp/eslint-config/base`, `src/index.ts` as the single export surface, and a
`README.md`. Add it to the root `tsconfig.json`'s `references` array too.
