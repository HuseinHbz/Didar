-- Rollback for 20260820000000_returns_refunds_credit_notes.
-- Reverses every section in exact reverse order; every operation here is
-- a pure drop of something this migration's own `migration.sql` added —
-- no existing row's business data is touched by either direction of this
-- migration (commerce.refunds loses only the new, additive
-- `return_request_id` column; every pre-existing refund row and column
-- is otherwise untouched).

BEGIN;

DROP SEQUENCE IF EXISTS "finance"."credit_note_number_seq";
DROP SEQUENCE IF EXISTS "commerce"."return_number_seq";

DROP TABLE IF EXISTS "finance"."credit_note_lines";
DROP TABLE IF EXISTS "finance"."credit_notes";
DROP TYPE IF EXISTS "finance"."CreditNoteStatus";

DROP TABLE IF EXISTS "commerce"."refund_lines";

ALTER TABLE "commerce"."refunds" DROP CONSTRAINT IF EXISTS "refunds_return_request_id_fkey";
DROP INDEX IF EXISTS "commerce"."refunds_return_request_id_idx";
ALTER TABLE "commerce"."refunds" DROP COLUMN IF EXISTS "return_request_id";

DROP TABLE IF EXISTS "commerce"."return_status_history";
DROP TABLE IF EXISTS "commerce"."return_items";
DROP TABLE IF EXISTS "commerce"."return_requests";

DROP TYPE IF EXISTS "commerce"."ReturnItemCondition";
DROP TYPE IF EXISTS "commerce"."ReturnResolution";
DROP TYPE IF EXISTS "commerce"."ReturnReason";
DROP TYPE IF EXISTS "commerce"."ReturnStatus";

COMMIT;
