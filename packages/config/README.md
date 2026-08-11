# @iecp/tsconfig

Shared `tsconfig.json` bases. All strict — this is the enforcement mechanism for the
project rule "use TypeScript strict mode".

| File                 | Extend from                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `base.json`          | Universal strict flags (no lib/module/jsx — set by the environment-specific configs below) |
| `nextjs.json`        | Next.js apps                                                                               |
| `nestjs.json`        | NestJS services                                                                            |
| `react-library.json` | Shared React component packages                                                            |

## Usage

```jsonc
// apps/storefront/tsconfig.json
{
  "extends": "@iecp/tsconfig/nextjs.json",
  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
}
```

`base.json` turns on `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, and `noUnusedLocals`. Combined with
`@iecp/eslint-config`'s ban on `@typescript-eslint/no-explicit-any`, this is what
makes "no `any` type allowed" an enforced rule instead of a suggestion.
