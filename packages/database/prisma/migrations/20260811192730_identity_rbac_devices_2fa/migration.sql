-- Hand-assembled (not `prisma migrate dev`'s raw output verbatim) because
-- `permissions.module`/`permissions.action` are new NOT NULL columns on a
-- table that already has rows (this repo's own seed data) — Prisma's
-- generated diff adds them straight as NOT NULL with no default, which
-- fails against existing rows. The safe, standard pattern is used instead:
-- add nullable, backfill from the existing `key` column, then constrain.
-- Everything else below is Prisma's own diff, unmodified.

-- CreateEnum
CREATE TYPE "identity"."TwoFactorMethod" AS ENUM ('TOTP');

-- CreateEnum
CREATE TYPE "identity"."PermissionEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "identity"."SecurityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'OTP_REQUESTED', 'OTP_VERIFIED', 'OTP_FAILED', 'PASSWORD_CHANGED', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'TWO_FACTOR_FAILED', 'SESSION_REVOKED', 'SESSION_REFRESHED', 'API_KEY_CREATED', 'API_KEY_REVOKED');

-- AlterTable (nullable first — see header comment)
ALTER TABLE "identity"."permissions" ADD COLUMN     "action" TEXT,
ADD COLUMN     "module" TEXT;

-- Backfill: existing `key` values are "<module>.<action...>" (e.g.
-- "product.publish", "refund.approve") — split on the first dot.
UPDATE "identity"."permissions"
SET "module" = split_part("key", '.', 1),
    "action" = substring("key" FROM position('.' IN "key") + 1)
WHERE "module" IS NULL;

-- Now safe to constrain.
ALTER TABLE "identity"."permissions" ALTER COLUMN "action" SET NOT NULL,
ALTER COLUMN "module" SET NOT NULL;

-- AlterTable
ALTER TABLE "identity"."roles" ADD COLUMN     "parent_id" UUID;

-- AlterTable
ALTER TABLE "identity"."user_sessions" ADD COLUMN     "device_id" UUID;

-- AlterTable
ALTER TABLE "system"."audit_logs" ADD COLUMN     "actor_device" TEXT;

-- CreateTable
CREATE TABLE "identity"."user_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "label" TEXT,
    "platform" TEXT,
    "trusted_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."user_two_factor_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "identity"."TwoFactorMethod" NOT NULL DEFAULT 'TOTP',
    "secret_encrypted" TEXT NOT NULL,
    "recovery_codes_hashed" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_two_factor_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."user_permission_overrides" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "effect" "identity"."PermissionEffect" NOT NULL,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."security_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "type" "identity"."SecurityEventType" NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "identity"."user_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_id_fingerprint_key" ON "identity"."user_devices"("user_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "user_two_factor_credentials_user_id_key" ON "identity"."user_two_factor_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_overrides_user_id_permission_id_key" ON "identity"."user_permission_overrides"("user_id", "permission_id");

-- CreateIndex
CREATE INDEX "security_events_user_id_created_at_idx" ON "identity"."security_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_type_created_at_idx" ON "identity"."security_events"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_module_action_key" ON "identity"."permissions"("module", "action");

-- CreateIndex
CREATE INDEX "roles_parent_id_idx" ON "identity"."roles"("parent_id");

-- CreateIndex
CREATE INDEX "user_sessions_device_id_idx" ON "identity"."user_sessions"("device_id");

-- AddForeignKey
ALTER TABLE "identity"."user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."user_sessions" ADD CONSTRAINT "user_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "identity"."user_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."user_two_factor_credentials" ADD CONSTRAINT "user_two_factor_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."roles" ADD CONSTRAINT "roles_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "identity"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "identity"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."security_events" ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
