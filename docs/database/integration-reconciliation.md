# CP-015 — Database reconciliation evidence

Companion to [`../product/integration-reconciliation.md`](../product/integration-reconciliation.md).
This document is the full record of Phase 3's database-specific proof —
the phase's own declared P0 priority.

## Migration history

11 migrations, strict chronological order, no gaps, no renumbering:

```
20260811181736_init_enterprise_foundation
20260811192730_identity_rbac_devices_2fa
20260812105606_catalog_merchandising_foundation
20260812180528_inventory_warehouse_ledger_foundation
20260812225852_cart_checkout_pricing_foundation
20260813000000_payment_orchestration_foundation
20260814000000_order_fulfillment_foundation
20260819000000_promotion_pricing_foundation
20260819120000_order_lifecycle_hardening
20260820000000_returns_refunds_credit_notes       ← CP-012
20260821000000_return_settlement_reconciliation   ← CP-013
```

Every migration ships a hand-authored `down.sql`. No migration was
deleted, squashed, or renumbered to "obtain a clean status" — the hard
requirement this phase's own brief names explicitly. `migration_lock.toml`
unchanged (`provider = "postgresql"`).

## Fresh database, from zero — the real proof

1. `CREATE DATABASE iecp_fresh_cp015` — a brand-new, genuinely empty
   database in the same Postgres cluster, distinct from the long-lived
   sandbox `iecp` database every other check in this session (and every
   prior phase's own validation) has run against.
2. `infrastructure/postgres/init/01-schemas.sql` run against it — all 11
   domain schemas created.
3. Least-privilege grants applied — `iecp_migrator`/`iecp_app` (roles
   already existed cluster-wide from earlier work; only the `GRANT`
   statements, not `CREATE ROLE`, were re-run, targeted at the new
   database) — same grant shape as `infrastructure/postgres/init/02-roles.sql`.
4. `prisma migrate deploy` as `iecp_migrator`, `DATABASE_URL` pointed at
   `iecp_fresh_cp015`:

   ```
   11 migrations found in prisma/migrations
   Applying migration `20260811181736_init_enterprise_foundation`
   ...
   Applying migration `20260821000000_return_settlement_reconciliation`
   All migrations have been successfully applied.
   ```

   Every migration applied cleanly, in order, no manual intervention, no
   error, no skipped statement.

5. `pnpm exec tsx prisma/seed.ts` against the same fresh database — ran
   to completion, producing the full realistic fixture set (RBAC,
   catalog, inventory, cart-checkout, payment, order, **returns — two
   full-lifecycle `COMPLETED` returns, one `REFUND`-resolution with a
   real `Refund`+`RefundLine`, one `CREDIT_NOTE`-resolution with a real
   `ISSUED` `CreditNote`**, promotion, CMS/notification/system basics).
   Directly verified by query, not just trusting the seed script's own
   log line:

   ```sql
   SELECT id, status, restock_completed_at IS NOT NULL AS restocked,
          settled_at IS NOT NULL AS settled
   FROM commerce.return_settlements;
   -- 2 rows, both status=COMPLETED, restocked=t, settled=t

   SELECT status FROM finance.credit_notes;
   -- 1 row, status=ISSUED
   ```

6. **`prisma migrate status` against this fresh database: "Database
   schema is up to date!"** — meaningful this time, unlike every prior
   check in this session against the long-lived sandbox database (which
   was contaminated by branch-hopping within one shared session — the
   CP-014 audit already documented that caveat explicitly; this fresh
   database has no such history).
7. **`prisma migrate diff --from-schema-datamodel schema.prisma
--to-schema-datasource schema.prisma` against this fresh database:
   `-- This is an empty migration.`** — the definitive, uncontaminated
   zero-drift proof this session has been building toward since the
   Phase 014 audit first flagged the sandbox-contamination caveat.
8. **Least-privilege enforcement, verified directly, not merely
   configured:**

   ```
   iecp_app: ALTER TABLE commerce.return_settlements ADD COLUMN ...
     → ERROR: must be owner of table return_settlements   (correctly denied)
   iecp_app: SELECT count(*) FROM commerce.return_settlements
     → 2                                                    (correctly allowed)
   iecp_app: DROP TABLE commerce.return_settlements
     → ERROR: must be owner of table return_settlements   (correctly denied)
   ```

9. The compiled API booted successfully against this fresh database
   (`DATABASE_URL` pointed at `iecp_fresh_cp015` as `iecp_app`), mapped
   every route, ran every BullMQ sweep once, answered a real health
   check, and shut down cleanly on `SIGTERM`. See
   [`../architecture/integration-reconciliation.md`](../architecture/integration-reconciliation.md)
   for the full runtime detail.
10. `iecp_fresh_cp015` was dropped after this proof completed — it was a
    verification artifact, not a fixture to carry forward.

## Main dev database cross-check

Separately, `prisma migrate status` against the long-lived sandbox `iecp`
database (already at all 11 migrations from earlier phases' work within
this session) also reports "up to date" — consistent with the fresh-DB
result, though this specific check carries the sandbox-reuse caveat the
fresh-DB proof above exists specifically to route around.

## Hard requirements — checked against actual evidence, not asserted

- No migration deleted merely to obtain a clean status — **true**, 11
  migrations present, all pre-existing, none removed.
- No manual database modifications not represented in migrations —
  **true** — every schema object present in the fresh database traces to
  a migration file; the empty `migrate diff` result is the direct proof.
- No schema drift — **true**, proven twice (fresh DB `migrate diff`
  empty; fresh DB `migrate status` "up to date").
- Fresh database reproduces the expected schema — **true**, demonstrated
  end to end including data-level fixtures, not just DDL.
- Existing CP-012/013 data contracts remain valid — **true**, the exact
  same seed script that shipped with CP-013 ran unmodified and produced
  the exact same fixture shape it was designed to produce.
