import {
  CART_ABANDONMENT_QUEUE,
  CHECKOUT_EXPIRATION_QUEUE,
} from '../cart-checkout/infrastructure/queues/queue-names';
import {
  INVENTORY_EVENT_PROCESSING_QUEUE,
  LOW_STOCK_NOTIFICATION_QUEUE,
  RESERVATION_EXPIRATION_QUEUE,
} from '../inventory/infrastructure/queues/queue-names';
import {
  INVOICE_GENERATION_QUEUE,
  ORDER_CONVERSION_QUEUE,
} from '../order/infrastructure/queues/queue-names';
import {
  PAYMENT_VERIFICATION_RETRY_QUEUE,
  RECONCILIATION_QUEUE,
  REFUND_STATUS_SYNC_QUEUE,
} from '../payment/infrastructure/queues/queue-names';
import {
  COUPON_RESERVATION_CLEANUP_QUEUE,
  PROMOTION_EXPIRATION_QUEUE,
} from '../promotion/infrastructure/queues/queue-names';
import {
  RETURN_RECONCILIATION_QUEUE,
  RETURN_SETTLEMENT_RECOVERY_QUEUE,
  RETURN_SETTLEMENT_SYNC_QUEUE,
} from '../return/infrastructure/queues/queue-names';

/**
 * CP-029 (P1-5) — every real BullMQ queue this API owns, reused here (not
 * re-declared) from each domain module's own `queue-names.ts`. Every queue
 * name that exists in this codebase must appear here — the domain audit for
 * this list is `docs/product/phase-029-audit.md` §3's queue inventory table,
 * cross-checked against `grep -rn "_QUEUE = " services/api/src/modules/*\/
 * infrastructure/queues/queue-names.ts`.
 */
export const MONITORED_QUEUE_NAMES: readonly string[] = [
  CHECKOUT_EXPIRATION_QUEUE,
  CART_ABANDONMENT_QUEUE,
  RESERVATION_EXPIRATION_QUEUE,
  LOW_STOCK_NOTIFICATION_QUEUE,
  INVENTORY_EVENT_PROCESSING_QUEUE,
  ORDER_CONVERSION_QUEUE,
  INVOICE_GENERATION_QUEUE,
  PAYMENT_VERIFICATION_RETRY_QUEUE,
  RECONCILIATION_QUEUE,
  REFUND_STATUS_SYNC_QUEUE,
  PROMOTION_EXPIRATION_QUEUE,
  COUPON_RESERVATION_CLEANUP_QUEUE,
  RETURN_SETTLEMENT_SYNC_QUEUE,
  RETURN_SETTLEMENT_RECOVERY_QUEUE,
  RETURN_RECONCILIATION_QUEUE,
];
