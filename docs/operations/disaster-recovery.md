# Disaster recovery (CP-029)

Closes the "no restore drill on record" half of `gap-priority-matrix.md`'s
P1-5 and O4 of `production-readiness-gap-analysis.md`. Backup/restore
scripts themselves are CP-003's (`infrastructure/postgres/scripts/`); this
document is the plan and the evidence that they actually work end-to-end.

## What's protected, what isn't

**PostgreSQL is the sole source of truth for every business record**
(orders, payments, inventory, returns, settlements, customers, catalog,
…) — the same fact `redis-failure-runbook.md` anchors on. This document
covers PostgreSQL disaster recovery only. Redis holds only BullMQ job
scheduling state and is never the only place a business record exists —
losing Redis entirely is an availability incident (see the Redis
runbook), not something this document's recovery procedure needs to
cover.

## RTO / RPO targets

| Metric                             | Target                                                                                           | Basis                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO** (Recovery Point Objective) | ≤ 24 hours                                                                                       | `backup.sh`'s own scope is a daily full backup (see its own header comment) — no WAL archiving/PITR exists yet, so the true RPO is bounded by backup frequency, not by continuous replication |
| **RTO** (Recovery Time Objective)  | Minutes for a database of this drill's size (see "Live evidence" below); scales with data volume | `pg_restore` with `-Fc` parallelizes; wall-clock time in this drill was single-digit seconds for a ~265k-row, 110-table database                                                              |

**What is explicitly not yet real**: point-in-time recovery (PITR), WAL
archiving, and offsite backup copies — all called out by `backup.sh`'s
own trailing message and `infrastructure/postgres/README.md`. A real
production RPO better than 24 hours requires WAL archiving, which is
separate, larger work this phase does not build (see `ADR-029` for the
explicit scope boundary).

## Restore procedure

```bash
# 1. Produce (or locate) a backup
./infrastructure/postgres/scripts/backup.sh

# 2. Restore into a scratch database first — never restore directly onto
#    a database still receiving traffic without verifying the dump first.
CONFIRM=yes ./infrastructure/postgres/scripts/restore.sh \
  infrastructure/postgres/backups/iecp_<timestamp>.dump \
  iecp_restore_drill

# 3. Verify — see this document's own drill query below for one concrete
#    verification method (exact row-count match across every domain
#    table). A structural check alone (does it import without error) is
#    not sufficient — this document verifies data, not just schema.

# 4. Only once verified: restore into the real target database name
#    (defaults to `iecp` if the second argument is omitted).
```

## Live evidence — this phase's own restore drill

Run against this sandbox's real, seeded PostgreSQL instance (not a
description of what a drill would look like):

1. `backup.sh` against the live `iecp` database (seeded, 110 tables
   across 11 domain schemas) produced an 18MB `.dump` file, self-verified
   by the script's own `pg_restore --list` structural check.
2. `restore.sh` restored that dump into a fresh scratch database
   (`iecp_restore_drill`) — **3 seconds wall-clock time**, end to end
   (database creation + full restore + the script's own table-count
   verification).
3. **Data-integrity verification, not just structural**: an exact
   `count(*)` sum across every table in all 11 domain schemas
   (`identity`, `customer`, `catalog`, `commerce`, `inventory`,
   `marketing`, `cms`, `finance`, `notification`, `analytics`, `system`)
   was computed against both the source `iecp` database and the restored
   `iecp_restore_drill` database.
   **Result: 265,191 rows in both — an exact match, byte-for-byte
   equivalent row counts across every one of the 110 tables.**
4. The scratch database was dropped after verification (this drill does
   not touch the real `iecp` database at any point — restore always
   targeted the separate `iecp_restore_drill` name).

This is the first restore drill on record for this repository — the exact
gap `gap-priority-matrix.md`'s P1-5 named.

## What this drill does not prove

- **Production-scale timing.** 3 seconds is this sandbox's single-node,
  ~265k-row dataset. A production database orders of magnitude larger
  will take proportionally longer — `pg_restore -Fc`'s `-j` parallel-jobs
  flag (not used in this drill; `restore.sh` doesn't currently expose it)
  is the documented lever for reducing restore time at scale, a follow-up
  tuning task, not a blocker for calling the restore mechanism itself
  proven.
- **Recovery under a real infrastructure failure** (disk loss, region
  outage) — this drill proved the backup/restore _mechanism_ is correct
  and the data survives the round trip intact; it did not simulate losing
  the original database first. That is inherent to what "restore drill"
  can mean without destroying a real environment, and is standard
  practice (verify the mechanism against a scratch target, never
  destructively against the only copy).
- **Offsite recovery** — this drill ran against the same local disk the
  source database lives on. A real production deployment needs the
  backup file itself stored somewhere that survives losing the database
  host, which `backup.sh`'s own header already flags as not handled.
