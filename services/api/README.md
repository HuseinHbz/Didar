# @iecp/api

The API gateway every client (`storefront`, `admin`, `pwa`, `mobile`) talks to —
NestJS, domain-based modules (blueprint §2), clean architecture layering within
each module (blueprint §3). See `src/modules/identity/README.md` for the concrete
layering example.

- **Global prefix**: `/api/v1` (blueprint §70 — versioned from day one).
- **Docs**: Swagger UI at `/api/v1/docs` once running.
- **Health**: `GET /api/v1/health` — no auth (`@Public()`), checks DB connectivity.
- **Security baseline**: `helmet()`, CORS restricted to `CORS_ORIGIN`,
  whitelist+forbidNonWhitelisted `ValidationPipe` (extra/unknown fields are
  rejected, not silently dropped), a global `JwtAuthGuard` (every route needs a
  Bearer token unless marked `@Public()`) + `AuthorizationGuard`
  (`@RequirePermission`/`@RequireModule`) — both from `modules/identity`,
  registered once and applied app-wide (`src/common/decorators/public.decorator.ts`
  is where any future module opts a route out of the former).

## Modules that exist so far

| Module      | What's real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health`    | Fully real — DB liveness check via `@iecp/database`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `identity`  | Real enterprise auth/RBAC: mobile OTP, email+password, refresh-token rotation, TOTP 2FA, role inheritance, per-user permission overrides, field-level permissions, sessions/devices/API keys/audit log. See `src/modules/identity/README.md` for the full picture and what's still out of scope.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `catalog`   | Real product catalog/merchandising: brands, hierarchical categories, manual/dynamic collections, the full product publication lifecycle (`DRAFT → IN_REVIEW → APPROVED → PUBLISHED → UNPUBLISHED`/`ARCHIVED`), the variant/SKU split, storage-agnostic media, admin-defined attributes, pricing (`finance.ProductPrice`/`PriceHistory`), a public storefront read surface. Reuses identity's guards/RBAC/audit log wholesale. See `src/modules/catalog/README.md`.                                                                                                                                                                                                                                            |
| `inventory` | Real multi-warehouse inventory: warehouses/locations, an append-only stock ledger (13-value movement vocabulary) with quantity buckets as a maintained cache, an idempotent/concurrency-safe reservation engine (never oversells — proven under real 100-way concurrency), stock transfers (9-state lifecycle), adjustments, stock counts, a config-driven allocation engine, barcode/SKU lookup, a public storefront availability surface, and its own BullMQ queues (reservation expiration, low-stock notification, event publishing). Reuses identity's guards/RBAC/audit log wholesale; integrates with catalog's SKU model without duplicating product identity. See `src/modules/inventory/README.md`. |

Every other domain in blueprint §2 (`customer`, `order`, …) doesn't exist
yet — it lands once its slice of the Phase 1 ERD is designed.

## Running locally

```bash
cp .env.example .env                          # then point DATABASE_URL at a real Postgres (iecp_app role); REDIS_URL for inventory's queues
pnpm --filter @iecp/database migrate:dev      # applies the schema (11 domain schemas, see docs/database/)
pnpm --filter @iecp/database seed             # admin/customer/support_agent + inventory-role users, roles, permissions
pnpm --filter @iecp/api dev                   # http://localhost:4000/api/v1
```

Or via Docker Compose — see `infrastructure/docker/docker-compose.yml` — which
brings up Postgres/Redis/OpenSearch for the whole monorepo at once. A local
Redis is required to boot this service since Phase 006 — `modules/inventory`
registers 3 BullMQ queues at startup.

## Tests

```bash
pnpm --filter @iecp/api test        # unit tests — no DB required
pnpm --filter @iecp/api test:e2e    # e2e — requires a migrated + seeded DATABASE_URL
```

See `src/modules/identity/README.md#testing` for what the e2e suite actually
covers (JWT validation, permission bypass incl. role inheritance and a
deny-override, session expiration/rotation, a full 2FA round trip) and why
`test/mocks/otplib.cjs` exists.
