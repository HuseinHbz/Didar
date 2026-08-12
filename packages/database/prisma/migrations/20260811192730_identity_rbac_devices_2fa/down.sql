-- Down-migration for 20260811192730_identity_rbac_devices_2fa.
--
-- Hand-generated (see packages/database/scripts/db-rollback.sh) via:
--
--   pnpm exec prisma migrate diff \
--     --from-schema-datamodel prisma/schema.prisma \
--     --to-migrations <a copy of prisma/migrations with this migration's
--                       folder removed> \
--     --script
--
-- This is the recipe change flagged in the previous migration's down.sql:
-- with two migrations now in history, "undo the last one" is no longer the
-- same as "undo everything" — the diff target is the PRIOR migration's
-- state (a temporary copy of prisma/migrations without this folder), not
-- `--to-empty`. The next migration's down.sql needs the same treatment,
-- diffed against a copy of history with both this one and the new one
-- removed.
--
-- Note: rolling back this migration drops `permissions.module`/`action`
-- entirely — any data in those columns (including the backfill this
-- migration's own up-migration performed) is lost, same as any column drop.
-- That's expected for a schema-reverting rollback, not a bug.

-- DropForeignKey
ALTER TABLE "identity"."user_devices" DROP CONSTRAINT "user_devices_user_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."user_sessions" DROP CONSTRAINT "user_sessions_device_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."user_two_factor_credentials" DROP CONSTRAINT "user_two_factor_credentials_user_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."roles" DROP CONSTRAINT "roles_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."user_permission_overrides" DROP CONSTRAINT "user_permission_overrides_user_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."user_permission_overrides" DROP CONSTRAINT "user_permission_overrides_permission_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."security_events" DROP CONSTRAINT "security_events_user_id_fkey";

-- DropIndex
DROP INDEX "identity"."user_sessions_device_id_idx";

-- DropIndex
DROP INDEX "identity"."roles_parent_id_idx";

-- DropIndex
DROP INDEX "identity"."permissions_module_action_key";

-- AlterTable
ALTER TABLE "identity"."user_sessions" DROP COLUMN "device_id";

-- AlterTable
ALTER TABLE "identity"."roles" DROP COLUMN "parent_id";

-- AlterTable
ALTER TABLE "identity"."permissions" DROP COLUMN "action",
DROP COLUMN "module";

-- AlterTable
ALTER TABLE "system"."audit_logs" DROP COLUMN "actor_device";

-- DropTable
DROP TABLE "identity"."user_devices";

-- DropTable
DROP TABLE "identity"."user_two_factor_credentials";

-- DropTable
DROP TABLE "identity"."user_permission_overrides";

-- DropTable
DROP TABLE "identity"."security_events";

-- DropEnum
DROP TYPE "identity"."TwoFactorMethod";

-- DropEnum
DROP TYPE "identity"."PermissionEffect";

-- DropEnum
DROP TYPE "identity"."SecurityEventType";
