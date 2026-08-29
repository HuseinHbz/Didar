-- Rollback for 20260829000000_customer_domain_prescription. Reverses
-- each of the 2 schema sections in migration.sql, in reverse order.
-- Purely additive migration, so rollback is purely subtractive.

-- 2. customer.prescriptions (table drop cascades its own FK/indexes/
--    CHECK constraints)
DROP TABLE "customer"."prescriptions";
DROP TYPE "customer"."PrescriptionStatus";

-- 1. customer.customer_addresses — drop the new partial unique index
--    only; the table itself predates this migration and is untouched.
DROP INDEX "customer"."customer_addresses_one_default_per_customer";
