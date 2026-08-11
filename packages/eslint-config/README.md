# @iecp/eslint-config

Shared ESLint 10 flat configs for every TypeScript project in the monorepo.

## Exports

| Import                              | Use in                                          |
| ----------------------------------- | ----------------------------------------------- |
| `@iecp/eslint-config/base`          | Plain TypeScript packages (`packages/*`)        |
| `@iecp/eslint-config/next`          | Next.js apps (`storefront`, `admin`, `pwa`)     |
| `@iecp/eslint-config/nestjs`        | NestJS services (`services/*`)                  |
| `@iecp/eslint-config/react-library` | Plain React component libraries (`packages/ui`) |

## Usage

```js
// eslint.config.mjs
import { nextConfig } from '@iecp/eslint-config/next';

export default nextConfig;
```

## Non-negotiable rule

`base.mjs` turns on `typescript-eslint`'s `strictTypeChecked` + `stylisticTypeChecked`
rule sets and hard-errors on `@typescript-eslint/no-explicit-any` and all `no-unsafe-*`
rules. This is the enforcement mechanism for the project rule "no `any` type allowed" —
do not weaken these in a consuming project's `eslint.config.mjs` without an ADR.
