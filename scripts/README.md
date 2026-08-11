# scripts

- **`validate-structure.mjs`** — repository structure validation (`pnpm
validate:structure`). Checks the required `apps/`/`services/`/`packages/`/
  `infrastructure/`/`docs/` layout and each workspace's manifest + README exist.
  Pure Node, no dependencies, doesn't require `pnpm install` to have run first —
  intentionally the fastest of the repo's three standard checks (structure /
  typecheck / build).
