# @iecp/admin

Internal admin panel — Next.js 16 App Router, React 19, TypeScript strict. Runs on
port 3001 in dev (`storefront` owns 3000) so both can run side by side.

## Scope (target, not yet built)

Per `docs/product/blueprint.md` §51-§55: dashboard, full Commerce/Inventory/Stores/
CRM/CMS/Marketing/Finance/Analytics/System navigation, fine-grained RBAC (down to
per-action permissions like `Product.Publish`), audit log, content approval
workflows, four-eyes principle for sensitive financial actions. Nothing beyond a
placeholder page exists yet.

## Not indexed

`robots: { index: false, follow: false }` is set in the root layout — this app is
never meant to appear in search results. Real deployments should also gate it behind
network-level access control (VPN/IP allowlist) or at minimum auth-wall every route,
once auth exists.

## Commands

```bash
pnpm --filter @iecp/admin dev      # http://localhost:3001
pnpm --filter @iecp/admin build
pnpm --filter @iecp/admin lint
pnpm --filter @iecp/admin typecheck
```
