# infrastructure/postgres

`init/` — scripts run once, automatically, the first time the `postgres`
container in `infrastructure/docker/docker-compose.yml` starts against an empty
data volume (standard `postgres` image behavior for anything mounted at
`/docker-entrypoint-initdb.d`).

- `01-schemas.sql` — creates the 11 domain-based schemas up front (see that
  file's header comment for why this is belt-and-braces rather than strictly
  required — Prisma's migration engine also creates them).
- `02-roles.sql` — creates the two least-privilege roles every environment
  needs (`iecp_migrator` for DDL/migrations, `iecp_app` for runtime DML only)
  and grants each exactly what its name says. See the file's header comment
  for the full rationale, and `docs/database/README.md#roles--least-privilege`
  for what a real (non-local) environment needs on top of this (secrets
  manager, credential rotation, environment-specific passwords — the
  passwords in this file are local dev defaults only, never reused anywhere
  real).

`scripts/` — backup and restore (blueprint §101):

- `backup.sh` — `pg_dump -Fc` full logical backup of `iecp`, verifies the
  archive is restorable (`pg_restore --list`), and prunes backups older than
  `RETENTION_DAYS` (default 7). Writes to `scripts/../backups/` by default
  (gitignored — dumps never get committed).
- `restore.sh` — `pg_restore --clean --if-exists` from a backup file, into
  `iecp` by default or a different database name (useful for a restore drill
  without touching the real database). Destructive by default and requires
  typed confirmation unless `CONFIRM=yes` is set (for scripted/CI use).

Both scripts were run against a real local Postgres as part of building them
— see `docs/database/README.md#backuprestore` for the full strategy this is
one piece of, and what's still missing for production readiness (hourly WAL
archiving, PITR, offsite storage — none of which a `pg_dump`-based script can
provide on its own).
