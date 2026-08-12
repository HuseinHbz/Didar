/**
 * Cross-cutting enums that are already architectural decisions (not admin-editable
 * content), per docs/product/blueprint.md. These are code, not data — see blueprint
 * §4 for the code-vs-data boundary this project draws.
 */

export const LOCALES = ['fa-IR', 'en-US'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Order status machine (blueprint §19 / §25). Linear happy path plus the
 * cancellation/return/refund side paths. Every transition is expected to be an
 * explicit, validated state-machine transition in `services/api`, never a bare
 * `order.status = X` — and every change is recorded in `order_status_history`.
 */
export const ORDER_STATUSES = [
  'CREATED',
  'PAYMENT_PENDING',
  'PAID',
  'CONFIRMED',
  'PROCESSING',
  'PRESCRIPTION_REVIEW',
  'LENS_PRODUCTION',
  'QUALITY_CONTROL',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURN_APPROVED',
  'RETURNED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Inventory ledger transaction types (blueprint §24/§27). Stock is derived, never set. */
export const INVENTORY_TRANSACTION_TYPES = [
  'PURCHASE',
  'SALE',
  'RESERVATION',
  'RELEASE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'DAMAGE',
  'ADJUSTMENT',
  'RETURN',
  'COUNT_ADJUSTMENT',
] as const;
export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[number];

/** Notification channels — always behind an adapter interface, never called directly. */
export const NOTIFICATION_CHANNELS = [
  'SMS',
  'TELEGRAM',
  'WHATSAPP',
  'EMAIL',
  'PUSH',
  'IN_APP',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** A per-user permission exception's direction (blueprint §53). DENY always wins. */
export const PERMISSION_EFFECTS = ['ALLOW', 'DENY'] as const;
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

/**
 * Identity security event types (blueprint §5/§55 `user_security_events`) —
 * a fixed, known set so it's queryable/alertable without parsing free-text
 * `AuditLog.action` strings. See packages/database's SecurityEvent model.
 */
export const SECURITY_EVENT_TYPES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'OTP_REQUESTED',
  'OTP_VERIFIED',
  'OTP_FAILED',
  'PASSWORD_CHANGED',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
  'TWO_FACTOR_FAILED',
  'SESSION_REVOKED',
  'SESSION_REFRESHED',
  'API_KEY_CREATED',
  'API_KEY_REVOKED',
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];
