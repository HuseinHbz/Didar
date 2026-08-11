# @iecp/database

Prisma ORM client for PostgreSQL. **This is the only supported way any service reads
or writes the database** — no service opens its own `pg` connection.

```ts
import { prisma } from '@iecp/database';

const user = await prisma.user.findUnique({ where: { id } });
```

## Structure

- `prisma/schema.prisma` — datasource + generator + models. Uses Prisma's
  `multiSchema` feature to map models onto PostgreSQL schemas grouped by business
  domain (`identity`, `customer`, `catalog`, `commerce`, `inventory`, `procurement`,
  `retail`, `crm`, `marketing`, `cms`, `finance`, `communication`, `analytics`,
  `system` — see blueprint §4/§57), instead of one flat namespace.
- `src/client.ts` — the singleton `PrismaClient` instance.
- `prisma/seed.ts` — `pnpm --filter @iecp/database seed`.

## ⚠️ Current status: conventions only, not the real ERD

`schema.prisma` currently has exactly one placeholder model (`User`), whose only job
is proving the toolchain works: multi-schema mapping, UUID PKs, audit timestamps,
soft delete, `prisma generate`, migrations. **It is not the identity domain's actual
shape.**

The full ERD (every table/column/type/PK/FK/index/enum/relation across all 14 domain
schemas) is dedicated Phase 1 work — see `docs/product/blueprint.md` ("وضعیت فعلی")
and `docs/database/README.md`. Do not build application features against this schema
as if it were final.

## Conventions for every future model

- Primary key: `id String @id @default(uuid()) @db.Uuid` (blueprint §58) — never a
  bare auto-increment `id`.
- Audit columns: `createdAt`/`updatedAt` (`@default(now())` / `@updatedAt`), mapped
  to `created_at`/`updated_at`.
- Soft delete: `deletedAt DateTime? @map("deleted_at")` on anything user- or
  business-facing (blueprint §59); physical deletes stay reserved for controlled
  cases only.
- Every model gets `@@map("snake_case_table_name")` and `@@schema("domain_name")`.

## Commands

```bash
pnpm --filter @iecp/database generate      # regenerate the Prisma client
pnpm --filter @iecp/database migrate:dev   # create + apply a dev migration
pnpm --filter @iecp/database studio        # Prisma Studio
pnpm --filter @iecp/database seed          # run prisma/seed.ts
```

Requires `DATABASE_URL` — copy `.env.example` to `.env` (or rely on the root
`.env` / `infrastructure/docker/docker-compose.yml` Postgres service for local dev).
