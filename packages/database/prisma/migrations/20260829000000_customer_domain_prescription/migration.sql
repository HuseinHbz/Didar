-- Phase 019 — customer domain & prescription
-- (docs/adr/ADR-019-customer-domain-prescription.md). Additive: no table
-- drops, no data transforms, no destructive operations. `customer.customers`
-- and `customer.customer_addresses` already exist (Phase 004) and are
-- untouched here except for one new partial unique index on the latter
-- (default-address integrity — see below).
--
-- 2 sections:
--   1. customer.customer_addresses — one new partial unique index,
--      guaranteeing at most one non-deleted default address per
--      customer (was previously enforced nowhere — a plain `is_default
--      Boolean` column with no constraint).
--   2. customer.prescriptions — the new PrescriptionStatus 6-state
--      lifecycle (PrescriptionStateMachine, domain layer), one row per
--      *version*. A second partial unique index guarantees at most one
--      APPROVED row per lineage (`root_id`) at a time — the concurrency
--      backstop CP-019's own acceptance criteria require ("no duplicate
--      active version"), real Postgres constraint, not just an
--      application-layer check, matching Phase 010's
--      promotion_usage_within_limit precedent.

-- 1. customer.customer_addresses — default-address integrity
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "customer_addresses_one_default_per_customer"
  ON "customer"."customer_addresses"("customer_id")
  WHERE "is_default" = true AND "deleted_at" IS NULL;

-- 2. customer.prescriptions
-- ---------------------------------------------------------------------------
CREATE TYPE "customer"."PrescriptionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

CREATE TABLE "customer"."prescriptions" (
    "id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "customer_id" UUID NOT NULL,
    "previous_version_id" UUID,
    "status" "customer"."PrescriptionStatus" NOT NULL DEFAULT 'DRAFT',

    "right_sph" INTEGER NOT NULL,
    "right_cyl" INTEGER,
    "right_axis" INTEGER,
    "right_add" INTEGER,
    "right_pd" INTEGER,

    "left_sph" INTEGER NOT NULL,
    "left_cyl" INTEGER,
    "left_axis" INTEGER,
    "left_add" INTEGER,
    "left_pd" INTEGER,

    "notes" TEXT,

    "issued_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    "submitted_at" TIMESTAMP(3),
    "review_started_at" TIMESTAMP(3),
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "superseded_at" TIMESTAMP(3),

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id"),
    -- Bounds mirror packages/validation/src/prescription.ts exactly
    -- (SPH ±20.00D, CYL ±10.00D, AXIS 0-180°, ADD 0.00-+4.00D, PD
    -- 20-80mm — stored as centi-diopters/centi-mm, see the Prisma
    -- schema's own doc comment on this model). A real Postgres
    -- constraint, not just a DTO-layer check — the same
    -- "backstop invariants at the database, not only in application
    -- code" convention Phase 010/021's own migrations already follow.
    CONSTRAINT "prescriptions_right_sph_range" CHECK ("right_sph" BETWEEN -2000 AND 2000),
    CONSTRAINT "prescriptions_left_sph_range" CHECK ("left_sph" BETWEEN -2000 AND 2000),
    CONSTRAINT "prescriptions_right_cyl_range" CHECK ("right_cyl" IS NULL OR "right_cyl" BETWEEN -1000 AND 1000),
    CONSTRAINT "prescriptions_left_cyl_range" CHECK ("left_cyl" IS NULL OR "left_cyl" BETWEEN -1000 AND 1000),
    CONSTRAINT "prescriptions_right_axis_range" CHECK ("right_axis" IS NULL OR "right_axis" BETWEEN 0 AND 180),
    CONSTRAINT "prescriptions_left_axis_range" CHECK ("left_axis" IS NULL OR "left_axis" BETWEEN 0 AND 180),
    CONSTRAINT "prescriptions_right_add_range" CHECK ("right_add" IS NULL OR "right_add" BETWEEN 0 AND 400),
    CONSTRAINT "prescriptions_left_add_range" CHECK ("left_add" IS NULL OR "left_add" BETWEEN 0 AND 400),
    CONSTRAINT "prescriptions_right_pd_range" CHECK ("right_pd" IS NULL OR "right_pd" BETWEEN 2000 AND 8000),
    CONSTRAINT "prescriptions_left_pd_range" CHECK ("left_pd" IS NULL OR "left_pd" BETWEEN 2000 AND 8000),
    -- AXIS is meaningful only when CYL is present — same rule
    -- eyeMeasurementSchema's own .refine() validates at the DTO layer,
    -- backstopped here too.
    CONSTRAINT "prescriptions_right_axis_requires_cyl" CHECK ("right_cyl" IS NULL OR "right_axis" IS NOT NULL),
    CONSTRAINT "prescriptions_left_axis_requires_cyl" CHECK ("left_cyl" IS NULL OR "left_axis" IS NOT NULL),
    CONSTRAINT "prescriptions_version_positive" CHECK ("version" >= 1)
);

ALTER TABLE "customer"."prescriptions"
  ADD CONSTRAINT "prescriptions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer"."prescriptions"
  ADD CONSTRAINT "prescriptions_previous_version_id_fkey"
  FOREIGN KEY ("previous_version_id") REFERENCES "customer"."prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- root_id deliberately has no FK to prescriptions.id: the first version
-- in a lineage has root_id = its own id, which would be a
-- not-yet-committed self-reference at INSERT time under a real FK. It
-- is validated in the application/domain layer instead (every write
-- path goes through PrismaPrescriptionRepository).
CREATE INDEX "prescriptions_customer_id_idx" ON "customer"."prescriptions"("customer_id");
CREATE INDEX "prescriptions_root_id_idx" ON "customer"."prescriptions"("root_id");

-- At most one APPROVED version per lineage at a time — the real
-- concurrency backstop for "no duplicate active version" (CP-019
-- acceptance criteria). Approving a new version and superseding the
-- old one happen in the same transaction, in that order (old row's
-- status flips to SUPERSEDED before the new row's flips to APPROVED),
-- so this index never sees two live APPROVED rows to contend with.
CREATE UNIQUE INDEX "prescriptions_one_approved_per_root"
  ON "customer"."prescriptions"("root_id")
  WHERE "status" = 'APPROVED';
