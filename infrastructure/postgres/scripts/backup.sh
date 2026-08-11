#!/usr/bin/env bash
# Full logical backup of the `iecp` database (blueprint §101: "Daily Full
# Backup" leg of the backup strategy — see infrastructure/postgres/README.md
# for what the other legs, WAL archiving/PITR/offsite, need and why they
# aren't set up by this script).
#
# Uses `pg_dump -Fc` (custom format): compressed, and the only format
# `pg_restore` can selectively restore from or parallelize with `-j`. A
# plain `.sql` dump is deliberately not used — it's harder to restore
# selectively and can't be restored in parallel on a large database.
#
# Usage:
#   ./backup.sh                      # backs up $DATABASE_URL (or the default below)
#   BACKUP_DIR=/mnt/backups ./backup.sh
#   RETENTION_DAYS=14 ./backup.sh    # default: 7
#
# Requires the `iecp_migrator` role (or another role with at least SELECT on
# every table) — `iecp_app` also works since backups only need read access,
# but `iecp_migrator` is what every other script in this repo already uses.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DATABASE_URL="${DATABASE_URL:-postgresql://iecp_migrator:change-me-migrator@localhost:5432/iecp}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/iecp_${TIMESTAMP}.dump"

echo "==> Backing up iecp to $OUT_FILE"
pg_dump "$DATABASE_URL" -Fc -f "$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "==> Backup complete: $OUT_FILE ($SIZE)"

# Verify the dump is structurally readable before trusting it — a truncated
# or corrupt file should fail loudly here, not during a real restore.
echo "==> Verifying archive integrity"
pg_restore --list "$OUT_FILE" > /dev/null
echo "==> Archive verified"

if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  echo "==> Pruning backups older than $RETENTION_DAYS day(s) from $BACKUP_DIR"
  find "$BACKUP_DIR" -maxdepth 1 -name 'iecp_*.dump' -mtime "+$RETENTION_DAYS" -print -delete
fi

echo "==> Done."
echo ""
echo "This script covers the 'Daily Full Backup' leg only. Offsite copies,"
echo "hourly WAL archiving, and point-in-time recovery are NOT handled here"
echo "— see infrastructure/postgres/README.md for what production needs on"
echo "top of this."
