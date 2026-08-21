/**
 * Cross-cutting enums that are already architectural decisions (not admin-editable
 * content), per docs/product/blueprint.md. These are code, not data — see blueprint
 * §4 for the code-vs-data boundary this project draws.
 */

export const LOCALES = ['fa-IR', 'en-US'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Order lifecycle (Phase 009 — see docs/adr/ADR-009-order-fulfillment.md
 * decision 5). Replaces the Phase 003 placeholder's 17-value
 * lens-manufacturing/return vocabulary with the real 8-state machine
 * nothing in this codebase drove honestly. CANCELLED/COMPLETED are
 * strictly terminal; CANCELLED is unreachable once PARTIALLY_FULFILLED or
 * later. Every transition is an explicit, validated `OrderStateMachine`
 * call in `services/api`, never a bare `order.status = X` — and every
 * change is recorded in `order_status_history`.
 */
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'READY_TO_FULFILL',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'CANCELLED',
  'COMPLETED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Cached alongside `status` (ADR-009 decision 3) — always derived from
 * Payment's own `PaymentTransaction`/`Refund` rows, never independently
 * tracked. */
export const ORDER_PAYMENT_STATUSES = [
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

/** Cached alongside `status` (ADR-009 decision 3) — always derived from
 * this order's own `FulfillmentItem` sums, never independently tracked. */
export const ORDER_FULFILLMENT_STATUSES = [
  'UNFULFILLED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
] as const;
export type OrderFulfillmentStatus = (typeof ORDER_FULFILLMENT_STATUSES)[number];

/** How an order came to exist (ADR-009 decision 11) — every value still
 * requires a real checkout/payment chain; `ADMIN`/`POS` never bypass it. */
export const ORDER_SOURCES = ['STOREFRONT', 'ADMIN', 'POS'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** Invoice lifecycle (ADR-009 decision 7) — immutable once ISSUED except
 * through an explicit VOID. */
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'VOID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Fulfillment lifecycle (ADR-009 decision 8) — CANCELLED is unreachable
 * once SHIPPED or later, same "physical reality" rule `OrderStatus`
 * applies. */
export const FULFILLMENT_STATUSES = [
  'PENDING',
  'ALLOCATED',
  'PROCESSING',
  'PACKED',
  'READY',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/** Shipment lifecycle (ADR-009 decision 12) — driven entirely by
 * `ManualShippingProvider` in this phase, no live courier webhook. */
export const SHIPMENT_STATUSES = [
  'PENDING',
  'IN_TRANSIT',
  'DELIVERED',
  'FAILED',
  'CANCELLED',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * Inventory ledger movement types (blueprint §24/§27; Phase 006 — see
 * docs/adr/ADR-006-inventory-architecture.md). Stock is derived, never set
 * directly. Replaces the smaller Phase 003 `InventoryTransactionType`
 * placeholder — see that migration's own header comment for the old->new
 * value mapping used to carry existing rows forward.
 */
export const INVENTORY_MOVEMENT_TYPES = [
  'PURCHASE_RECEIPT',
  'SALE',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RETURN_RECEIPT',
  'DAMAGE',
  'ADJUSTMENT',
  'COUNT_ADJUSTMENT',
  'QUARANTINE',
  'RELEASE_FROM_QUARANTINE',
  'MANUAL_CORRECTION',
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

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

/**
 * Catalog enums — Phase 005. See docs/adr/ADR-005-catalog-architecture.md
 * and packages/database's schema.prisma catalog section (the two must stay
 * in sync; there's no codegen linking them, so a Prisma enum change needs a
 * matching edit here).
 */
export const PRODUCT_GENDERS = ['MALE', 'FEMALE', 'UNISEX', 'KIDS'] as const;
export type ProductGender = (typeof PRODUCT_GENDERS)[number];

export const PRODUCT_TYPES = [
  'EYEGLASSES',
  'SUNGLASSES',
  'COMPUTER_GLASSES',
  'READING_GLASSES',
  'CONTACT_LENSES',
  'OPTICAL_FRAME',
  'LENS',
  'ACCESSORY',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/**
 * Product publication state machine — see
 * ProductLifecycleStateMachine (services/api's catalog domain layer) for
 * the actual transition rules; this is only the value set.
 */
export const PRODUCT_LIFECYCLE_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
] as const;
export type ProductLifecycleStatus = (typeof PRODUCT_LIFECYCLE_STATUSES)[number];

/** Simple on/off switch for brand/category/collection/variant. */
export const CATALOG_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const SKU_STATUSES = ['ACTIVE', 'INACTIVE', 'DISCONTINUED'] as const;
export type SkuStatus = (typeof SKU_STATUSES)[number];

export const COLLECTION_TYPES = ['MANUAL', 'DYNAMIC'] as const;
export type CollectionType = (typeof COLLECTION_TYPES)[number];

/** Storage abstraction — ADR-005 decision 3. */
export const MEDIA_PROVIDERS = ['LOCAL', 'S3', 'CDN'] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

export const MEDIA_KINDS = ['IMAGE', 'VIDEO', 'MODEL_3D', 'AR_ASSET'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_ROLES = [
  'PRIMARY',
  'GALLERY',
  'THUMBNAIL',
  'SWATCH',
  'VIDEO',
  'MODEL_3D',
] as const;
export type MediaRole = (typeof MEDIA_ROLES)[number];

export const MEDIA_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/**
 * Inventory/warehouse enums — Phase 006. See
 * docs/adr/ADR-006-inventory-architecture.md and packages/database's
 * schema.prisma inventory section (the two must stay in sync; there's no
 * codegen linking them, so a Prisma enum change needs a matching edit here).
 */
export const WAREHOUSE_TYPES = [
  'CENTRAL',
  'REGIONAL',
  'STORE',
  'DARK_STORE',
  'QUARANTINE',
] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

export const WAREHOUSE_STATUSES = ['ACTIVE', 'INACTIVE', 'CLOSED'] as const;
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number];

export const LOCATION_TYPES = [
  'RECEIVING',
  'PICKING',
  'STORAGE',
  'QUARANTINE',
  'DAMAGED',
  'RETURNS',
  'STAGING',
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const INVENTORY_RESERVATION_STATUSES = [
  'ACTIVE',
  'RELEASED',
  'CONVERTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type InventoryReservationStatus = (typeof INVENTORY_RESERVATION_STATUSES)[number];

/** The 9-state transfer machine — see `TransferStateMachine` (domain layer) for transitions. */
export const STOCK_TRANSFER_STATUSES = [
  'DRAFT',
  'REQUESTED',
  'APPROVED',
  'PICKING',
  'DISPATCHED',
  'IN_TRANSIT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type StockTransferStatus = (typeof STOCK_TRANSFER_STATUSES)[number];

export const INVENTORY_ADJUSTMENT_TYPES = ['POSITIVE', 'NEGATIVE'] as const;
export type InventoryAdjustmentType = (typeof INVENTORY_ADJUSTMENT_TYPES)[number];

export const STOCK_COUNT_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'COUNTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CLOSED',
] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

/** Reservation/adjustment source, kept as an open string union rather than a
 * fixed enum since it deliberately covers modules that don't exist yet
 * (cart/order/pos/home_try_on — ADR-006 decision 5). Values this phase
 * actually writes: 'ORDER' (legacy-migrated rows only), 'MANUAL' (an admin
 * test/internal reservation with no real upstream source yet). */
export const INVENTORY_RESERVATION_SOURCE_TYPES = [
  'CART',
  'ORDER',
  'POS',
  'HOME_TRY_ON',
  'MANUAL',
] as const;
export type InventoryReservationSourceType = (typeof INVENTORY_RESERVATION_SOURCE_TYPES)[number];

// =============================================================================
// cart/checkout — Phase 007 (see docs/adr/ADR-007-cart-checkout.md)
// =============================================================================

export const CART_STATUSES = [
  'ACTIVE',
  'CHECKOUT_STARTED',
  'ABANDONED',
  'CONVERTED',
  'EXPIRED',
] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

export const CHECKOUT_STATUSES = [
  'OPEN',
  'VALIDATING',
  'READY_FOR_PAYMENT',
  'EXPIRED',
  'CANCELLED',
  'CONVERTED',
] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

export const CHECKOUT_VALIDATION_OUTCOMES = ['PASSED', 'FAILED'] as const;
export type CheckoutValidationOutcome = (typeof CHECKOUT_VALIDATION_OUTCOMES)[number];

export const SHIPPING_METHOD_TYPES = ['HOME_DELIVERY', 'STORE_PICKUP'] as const;
export type ShippingMethodType = (typeof SHIPPING_METHOD_TYPES)[number];

/** `CartItemOption.optionType` — an open string union (not a DB enum) since
 * new option types (e.g. an engraving service) should be addable without a
 * migration; these are the ones this phase's domain layer actually
 * recognizes and validates. */
export const CART_ITEM_OPTION_TYPES = [
  'LENS_TYPE',
  'LENS_COATING',
  'PRESCRIPTION_REFERENCE',
  'CUSTOMIZATION_REFERENCE',
] as const;
export type CartItemOptionType = (typeof CART_ITEM_OPTION_TYPES)[number];

/** `CheckoutValidationResult.issues[].code` — every check the brief's
 * `checkout_validation` list names gets its own real code, not a generic
 * "invalid" string. */
export const CHECKOUT_VALIDATION_ISSUE_CODES = [
  'CUSTOMER_IDENTITY_INVALID',
  'CART_NOT_ACTIVE',
  'PRODUCT_NOT_PUBLISHED',
  'SKU_NOT_ACTIVE',
  'PRICE_CHANGED',
  'QUANTITY_INVALID',
  'INVENTORY_UNAVAILABLE',
  'RESERVATION_INVALID',
  'SHIPPING_METHOD_INVALID',
  'ADDRESS_INVALID',
  'PRESCRIPTION_REFERENCE_UNVERIFIED',
  'COUPON_INVALID',
] as const;
export type CheckoutValidationIssueCode = (typeof CHECKOUT_VALIDATION_ISSUE_CODES)[number];

// =============================================================================
// payment orchestration — Phase 008 (see docs/adr/ADR-008-payment-orchestration.md)
// =============================================================================

/** `PaymentIntent.status` — the durable "customer owes X" fact's lifecycle
 * (ADR-008 decision 2). */
export const PAYMENT_INTENT_STATUSES = [
  'CREATED',
  'AWAITING_PAYMENT',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

/** `PaymentAttempt.status` — one redirect round trip (ADR-008 decision 2). */
export const PAYMENT_ATTEMPT_STATUSES = [
  'INITIATED',
  'REDIRECTED',
  'RETURNED',
  'ABANDONED',
  'EXPIRED',
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

/** `PaymentTransaction.status` — verified settlement record; once
 * `VERIFIED` no code path updates the row again (ADR-008 decision 2). */
export const PAYMENT_TRANSACTION_STATUSES = ['PENDING', 'VERIFIED', 'FAILED'] as const;
export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUSES)[number];

/** `Refund.status` (ADR-008 decision 6) — replaces the unused Phase 003
 * placeholder `RefundStatus` shape, same "placeholder identified, replaced
 * with the real thing" precedent every prior phase set. */
export const REFUND_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REJECTED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** `ReconciliationRecord.status` — recorded, never auto-corrected (ADR-008
 * decision 7). */
export const RECONCILIATION_STATUSES = [
  'MATCHED',
  'AMOUNT_MISMATCH',
  'STATUS_MISMATCH',
  'MISSING_LOCAL',
  'MISSING_REMOTE',
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

/**
 * Promotion/coupon lifecycle (Phase 010 — see
 * docs/adr/ADR-010-promotion-engine.md).
 */
export const PROMOTION_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'ARCHIVED',
] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

/** `Promotion.discountType` — the minimum discount-type set this phase
 * implements (ADR-010 decision 3); no type beyond this list exists. */
export const PROMOTION_ACTION_TYPES = [
  'PERCENTAGE',
  'FIXED_AMOUNT',
  'FIXED_PRICE',
  'FREE_SHIPPING',
  'BUY_X_GET_Y',
  'BUNDLE_PRICE',
] as const;
export type PromotionActionType = (typeof PROMOTION_ACTION_TYPES)[number];

/** `PromotionTarget.type` — composable, OR'd (ADR-010 decision 4). No
 * `ALL` value: zero target rows already means "whole cart" unambiguously. */
export const PROMOTION_TARGET_TYPES = [
  'PRODUCT',
  'SKU',
  'CATEGORY',
  'BRAND',
  'COLLECTION',
] as const;
export type PromotionTargetType = (typeof PROMOTION_TARGET_TYPES)[number];

/** `PromotionRule.type` — eligibility conditions, structurally separate
 * from discount calculation (ADR-010 decision 6). */
export const PROMOTION_RULE_TYPES = [
  'MINIMUM_QUANTITY',
  'CUSTOMER_SEGMENT',
  'FIRST_PURCHASE_ONLY',
] as const;
export type PromotionRuleType = (typeof PROMOTION_RULE_TYPES)[number];

/** `Coupon.status` — a `DISABLED` coupon never reactivates automatically
 * (ADR-010 decision 2). */
export const COUPON_STATUSES = ['ACTIVE', 'PAUSED', 'EXPIRED', 'DISABLED'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

/** `CouponRedemption.status` — `RESERVED` (checkout freeze) ->
 * `REDEEMED` (order paid) or `RELEASED` (checkout cancelled/expired/
 * swept). Never deleted (ADR-010 decision 8). */
export const REDEMPTION_STATUSES = ['RESERVED', 'REDEEMED', 'RELEASED'] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

/**
 * Return lifecycle (Phase 012 — see
 * docs/adr/ADR-012-returns-refunds-credit-notes.md decision 1).
 * `REJECTED` only reachable from `REQUESTED`/`APPROVED`; `CANCELLED`
 * only from `REQUESTED`/`APPROVED`/`CUSTOMER_SHIPPING` — never once the
 * warehouse has physically received the goods. `COMPLETED` is a derived
 * fact, set only once the linked `Refund`/`CreditNote` actually settles.
 */
export const RETURN_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'CUSTOMER_SHIPPING',
  'RECEIVED',
  'INSPECTING',
  'APPROVED_FOR_REFUND',
  'REFUNDED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** `ReturnRequest.reason` — the customer-supplied (or admin-recorded)
 * reason category, never free-form beyond `OTHER` + `reasonNote`. */
export const RETURN_REASONS = [
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'SIZE_FIT_ISSUE',
  'OTHER',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/** `ReturnRequest.resolution` — what the return settles into: a real
 * refund through the one existing `RefundService` pathway, or a
 * `CreditNote` (ADR-012 decision 7). No exchange/replacement resolution
 * this phase. */
export const RETURN_RESOLUTIONS = ['REFUND', 'CREDIT_NOTE'] as const;
export type ReturnResolution = (typeof RETURN_RESOLUTIONS)[number];

/** `ReturnItem.condition` — recorded at the `INSPECTING` step; never set
 * before inspection has actually happened. */
export const RETURN_ITEM_CONDITIONS = [
  'UNOPENED',
  'OPENED_UNUSED',
  'USED',
  'DAMAGED',
  'DEFECTIVE',
] as const;
export type ReturnItemCondition = (typeof RETURN_ITEM_CONDITIONS)[number];

/** Credit-note lifecycle (ADR-012 decision 7) — mirrors `InvoiceStatus`'s
 * own shape. Never a historical-`Invoice` rewrite: `Invoice` +
 * `CreditNote` together represent the adjustment. */
export const CREDIT_NOTE_STATUSES = ['DRAFT', 'ISSUED', 'APPLIED', 'VOID'] as const;
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];
