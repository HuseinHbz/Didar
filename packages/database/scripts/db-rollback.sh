#!/usr/bin/env bash
# Rolls back the most recently applied Prisma migration.
#
# Prisma has no built-in "migrate down" — this script applies the migration's
# hand-generated down.sql (see the comment at the top of that file for how it
# was produced) and then removes the migration's row from Prisma's own
# bookkeeping table (`_prisma_migrations`) so `migrate dev`/`migrate deploy`
# see it as never applied and will re-run it cleanly.
#
# `prisma migrate resolve --rolled-back` is deliberately NOT used here: that
# command only accepts migrations Prisma itself marked "failed" (a partial
# apply during `migrate deploy`), and errors with P3012 on a migration that
# finished successfully — which is exactly our case, since down.sql just
# finished undoing a fully-applied migration by hand. Deleting the bookkeeping
# row directly is the documented workaround for this Prisma limitation.
#
# Usage:
#   pnpm --filter @iecp/database db:rollback -- <migration_name>
#   pnpm --filter @iecp/database db:rollback -- 20260811181736_init_enterprise_foundation
#
# Requires DATABASE_URL to point at the iecp_migrator role (the same
# requirement `prisma migrate dev` has) — iecp_app cannot run DDL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$PACKAGE_DIR/prisma/migrations"

MIGRATION_NAME="${1:-}"

if [[ -z "$MIGRATION_NAME" ]]; then
  echo "Usage: db-rollback.sh <migration_name>" >&2
  echo "" >&2
  echo "Available migrations:" >&2
  find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort >&2
  exit 1
fi

MIGRATION_DIR="$MIGRATIONS_DIR/$MIGRATION_NAME"
DOWN_SQL="$MIGRATION_DIR/down.sql"

if [[ ! -f "$DOWN_SQL" ]]; then
  echo "error: no down.sql found for migration '$MIGRATION_NAME' at $DOWN_SQL" >&2
  echo "Only migrations with a hand-generated down.sql can be rolled back this way." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set (needs the iecp_migrator connection string)" >&2
  exit 1
fi

# Prisma accepts a `?schema=` query parameter on the connection string;
# plain `psql` doesn't understand it and rejects the URI outright. Strip it
# before handing the URL to psql — the down.sql itself schema-qualifies
# every statement, so no default search_path is needed.
PSQL_URL="${DATABASE_URL%%\?*}"

echo "==> Applying down.sql for $MIGRATION_NAME"
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f "$DOWN_SQL"

echo "==> Removing migration from Prisma's migration history"
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM public._prisma_migrations WHERE migration_name = '$MIGRATION_NAME';"

echo "==> Done. '$MIGRATION_NAME' has been rolled back."
echo "    Re-apply with: pnpm --filter @iecp/database migrate:deploy"
