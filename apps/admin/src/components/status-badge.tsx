import type {
  FulfillmentStatus,
  OrderPaymentStatus,
  OrderStatus,
  ProductLifecycleStatus,
  ReturnSettlementStatus,
  ReturnStatus,
  StockTransferStatus,
} from '@iecp/types';
import { Badge, type BadgeProps } from '@iecp/ui';

/**
 * One `Record<Status, ...>` per status vocabulary, typed against
 * `@iecp/types`'s own string-union exports — adding a new backend status
 * value without updating the matching map here is a TypeScript compile
 * error (a missing key), never a silent "unknown" badge (ADR-018
 * decision 5).
 */
function makeBadge<Status extends string>(
  map: Record<Status, { tone: BadgeProps['tone']; label: string }>,
) {
  return function StatusBadgeComponent({ status }: { status: Status }) {
    const entry = map[status];
    return <Badge tone={entry.tone}>{entry.label}</Badge>;
  };
}

export const OrderStatusBadge = makeBadge<OrderStatus>({
  PENDING_PAYMENT: { tone: 'neutral', label: 'در انتظار پرداخت' },
  PAID: { tone: 'info', label: 'پرداخت‌شده' },
  PROCESSING: { tone: 'info', label: 'در حال پردازش' },
  READY_TO_FULFILL: { tone: 'info', label: 'آماده ارسال' },
  PARTIALLY_FULFILLED: { tone: 'warning', label: 'ارسال جزئی' },
  FULFILLED: { tone: 'success', label: 'ارسال‌شده' },
  CANCELLED: { tone: 'danger', label: 'لغوشده' },
  COMPLETED: { tone: 'success', label: 'تکمیل‌شده' },
});

export const OrderPaymentStatusBadge = makeBadge<OrderPaymentStatus>({
  UNPAID: { tone: 'neutral', label: 'پرداخت‌نشده' },
  PARTIALLY_PAID: { tone: 'warning', label: 'پرداخت جزئی' },
  PAID: { tone: 'success', label: 'پرداخت‌شده' },
  PARTIALLY_REFUNDED: { tone: 'warning', label: 'استرداد جزئی' },
  REFUNDED: { tone: 'danger', label: 'مستردشده' },
});

export const FulfillmentStatusBadge = makeBadge<FulfillmentStatus>({
  PENDING: { tone: 'neutral', label: 'در انتظار' },
  ALLOCATED: { tone: 'info', label: 'تخصیص‌یافته' },
  PROCESSING: { tone: 'info', label: 'در حال پردازش' },
  PACKED: { tone: 'info', label: 'بسته‌بندی‌شده' },
  READY: { tone: 'info', label: 'آماده' },
  SHIPPED: { tone: 'success', label: 'ارسال‌شده' },
  DELIVERED: { tone: 'success', label: 'تحویل‌شده' },
  CANCELLED: { tone: 'danger', label: 'لغوشده' },
});

export const ProductStatusBadge = makeBadge<ProductLifecycleStatus>({
  DRAFT: { tone: 'neutral', label: 'پیش‌نویس' },
  IN_REVIEW: { tone: 'warning', label: 'در حال بررسی' },
  APPROVED: { tone: 'info', label: 'تأییدشده' },
  PUBLISHED: { tone: 'success', label: 'منتشرشده' },
  UNPUBLISHED: { tone: 'warning', label: 'برداشته‌شده از انتشار' },
  ARCHIVED: { tone: 'neutral', label: 'بایگانی‌شده' },
});

export const TransferStatusBadge = makeBadge<StockTransferStatus>({
  DRAFT: { tone: 'neutral', label: 'پیش‌نویس' },
  REQUESTED: { tone: 'warning', label: 'درخواست‌شده' },
  APPROVED: { tone: 'info', label: 'تأییدشده' },
  PICKING: { tone: 'info', label: 'در حال جمع‌آوری' },
  DISPATCHED: { tone: 'info', label: 'ارسال‌شده' },
  IN_TRANSIT: { tone: 'info', label: 'در مسیر' },
  PARTIALLY_RECEIVED: { tone: 'warning', label: 'دریافت جزئی' },
  RECEIVED: { tone: 'success', label: 'دریافت‌شده' },
  CANCELLED: { tone: 'danger', label: 'لغوشده' },
});

export const ReturnStatusBadge = makeBadge<ReturnStatus>({
  REQUESTED: { tone: 'warning', label: 'درخواست‌شده' },
  APPROVED: { tone: 'info', label: 'تأییدشده' },
  CUSTOMER_SHIPPING: { tone: 'info', label: 'در حال ارسال توسط مشتری' },
  RECEIVED: { tone: 'info', label: 'دریافت‌شده' },
  INSPECTING: { tone: 'info', label: 'در حال بازرسی' },
  APPROVED_FOR_REFUND: { tone: 'info', label: 'تأییدشده برای استرداد' },
  REFUNDED: { tone: 'success', label: 'مستردشده' },
  COMPLETED: { tone: 'success', label: 'تکمیل‌شده' },
  REJECTED: { tone: 'danger', label: 'ردشده' },
  CANCELLED: { tone: 'danger', label: 'لغوشده' },
});

export const SettlementStatusBadge = makeBadge<ReturnSettlementStatus>({
  PENDING_RESTOCK: { tone: 'warning', label: 'در انتظار بازگشت به انبار' },
  RESTOCKED: { tone: 'info', label: 'بازگشت به انبار انجام‌شده' },
  REFUND_REQUESTED: { tone: 'info', label: 'درخواست استرداد ثبت‌شده' },
  SETTLED: { tone: 'success', label: 'تسویه‌شده' },
  COMPLETED: { tone: 'success', label: 'تکمیل‌شده' },
  FAILED_RETRYABLE: { tone: 'warning', label: 'ناموفق (قابل تلاش مجدد)' },
  FAILED_TERMINAL: { tone: 'danger', label: 'ناموفق نهایی' },
  MANUAL_REVIEW: { tone: 'danger', label: 'نیازمند بررسی دستی' },
});
