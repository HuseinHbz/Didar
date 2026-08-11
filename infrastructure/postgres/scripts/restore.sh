#!/usr/bin/env bash
# Restores a `pg_dump -Fc` backup produced by backup.sh.
#
# Destructive by default: restoring INTO an existing database drops and
# recreates every object the dump contains (`pg_restore --clean --if-exists`)
# so the target ends up byte-for-byte what the dump describes, not a merge.
# Requires explicit confirmation unless CONFIRM=yes is set (for scripted/CI
# use, e.g. a periodic restore-drill job — see docs/database/README.md).
#
# Usage:
#   ./restore.sh <dump_file> [target_database_name]
#   ./restore.sh ../backups/iecp_20260811T181736Z.dump
#   ./restore.sh ../backups/iecp_20260811T181736Z.dump iecp_restore_drill
#
# `target_database_name` defaults to `iecp`. Pass a different name (e.g. for
# a restore drill, or to verify a backup without touching the real
# database) — the script creates it if it doesn't already exist.

set -euo pipefail

DUMP_FILE="${1:-}"
TARGET_DB="${2:-iecp}"
CONFIRM="${CONFIRM:-}"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-iecp_migrator}"
PGPASSWORD="${PGPASSWORD:-change-me-migrator}"
export PGPASSWORD

ADMIN_DATABASE_URL="${ADMIN_DATABASE_URL:-postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/postgres}"
TARGET_DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${TARGET_DB}"

if [[ -z "$DUMP_FILE" ]]; then
  echo "Usage: restore.sh <dump_file> [target_database_name]" >&2
  exit 1
fi
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "error: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

echo "==> About to restore '$DUMP_FILE' into database '$TARGET_DB' at ${PGHOST}:${PGPORT}."
echo "    This DROPS every object currently in '$TARGET_DB' that the dump also defines."
if [[ "$CONFIRM" != "yes" ]]; then
  read -r -p "    Type the database name ('$TARGET_DB') to confirm: " ANSWER
  if [[ "$ANSWER" != "$TARGET_DB" ]]; then
    echo "Aborted: confirmation did not match." >&2
    exit 1
  fi
fi

echo "==> Ensuring database '$TARGET_DB' exists"
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -tc \
  "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'" | grep -q 1 || \
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TARGET_DB\" OWNER $PGUSER"

echo "==> Restoring (this can take a while for a large dump)"
pg_restore \
  --dbname="$TARGET_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$DUMP_FILE"

echo "==> Restore complete. Verifying table count across domain schemas."
psql "$TARGET_DATABASE_URL" -tc "
  SELECT count(*) FROM pg_tables
  WHERE schemaname IN (
    'identity','customer','catalog','commerce','inventory',
    'marketing','cms','finance','notification','analytics','system'
  );
"

echo "==> Done."
echo ""
echo "--no-owner/--no-privileges above mean iecp_app's grants are NOT part of"
echo "this restore — re-run infrastructure/postgres/init/02-roles.sql (or the"
echo "equivalent for the target environment) after restoring into a database"
echo "that doesn't already have those grants."
