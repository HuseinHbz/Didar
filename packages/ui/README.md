# @iecp/ui

Shared React component library for `storefront`, `admin`, and `pwa` — Tailwind CSS 4

- [shadcn/ui](https://ui.shadcn.com) conventions (Radix primitives,
  `class-variance-authority` variants, a `cn()` class-merge helper).

## Usage

```ts
import { Button, cn } from '@iecp/ui';
```

```css
/* app/globals.css in a consuming app */
@import 'tailwindcss';
@import '@iecp/ui/styles.css';
@source '../../../packages/ui/src';
```

The `@source` directive is required — Tailwind v4's automatic content detection scans
files reachable from the CSS file's own directory tree, and this package's source
lives outside each app's tree in the monorepo. Without it, classes used only inside
`@iecp/ui` components won't be generated.

## Design tokens are placeholders

`src/styles.css` currently ships shadcn/ui's stock neutral OKLCH palette as
`@theme` tokens — **not** a reviewed brand/design system. The real design system is
explicit future work (see `docs/product/blueprint.md`, ordered right after the
Phase 1 database/domain work). Change the token _values_ there when it lands; keep
consuming apps pointed at the same token _names_.

## Adding a component

Follow the existing `Button` (`src/components/button.tsx`) as the template: a
`cva()` variant map, `cn()` for class merging, Radix `Slot` for `asChild` composition
where relevant. Export new components from `src/index.ts`.

## Build

```
pnpm --filter @iecp/ui build
```
