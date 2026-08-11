# modules/identity

Reference implementation of the clean-architecture layering every domain module in
`services/api` should follow (blueprint §3):

```
identity/
├── domain/          — entities + repository ports (interfaces). No framework deps.
├── application/      — use cases. Orchestrates ports. No HTTP, no Prisma.
├── infrastructure/   — Prisma repository implementations. Only layer allowed to
│                       import @iecp/database.
├── presentation/     — NestJS controllers + DTOs. HTTP concerns only.
└── identity.module.ts — wires the port token to its infrastructure implementation.
```

Dependency direction is one-way: `presentation → application → domain ← infrastructure`.
`domain` depends on nothing else in this module.

## What's actually implemented

One endpoint, `GET /users/:id`, against the placeholder `User` model in
`packages/database` (see that package's README — it's a convention-proving
placeholder, not the real identity schema). This exists to prove the layering
compiles, wires through NestJS DI, and returns real data end to end — not to be a
starting point for real auth/identity features. The real identity domain (sessions,
OTP, 2FA, roles/permissions — blueprint §5) is Phase 1+ work.

## Adding a new domain module

Copy this folder's shape, not its content. Every other domain listed in blueprint
§2 (`customer`, `catalog`, `pricing`, `promotion`, `cart`, `checkout`, `order`,
`payment`, `fulfillment`, `inventory`, `procurement`, `supplier`, `store`, `pos`,
`prescription`, `optometry`, `appointment`, `loyalty`, `wallet`, `crm`, `support`,
`cms`, `marketing`, `notification`, `search`, `recommendation`, `ai`, `analytics`,
`reporting`, `finance`, `system`) gets its own `src/modules/<domain>/` here, once
its slice of the Phase 1 ERD exists.
