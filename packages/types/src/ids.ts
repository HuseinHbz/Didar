/**
 * Branded ID types.
 *
 * Every aggregate root in the domain model gets its own nominal ID type instead of a
 * bare `string`, so `orderService.get(customerId)` is a compile error instead of a
 * production incident. All IDs are UUIDs (see docs/product/blueprint.md §58).
 */

declare const brand: unique symbol;

/** Nominal-typing helper: attaches a compile-time-only brand to a base type. */
export type Brand<Base, Name extends string> = Base & { readonly [brand]: Name };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Builds a branded-ID constructor + type guard pair for one entity.
 *
 * @example
 * const { as: asCustomerId, is: isCustomerId } = brandedId<'CustomerId'>();
 * type CustomerId = ReturnType<typeof asCustomerId>;
 */
export function brandedId<Name extends string>(entityName: Name) {
  return {
    /** Casts a raw UUID string to the branded ID type. Throws on malformed input. */
    as: (value: string): Brand<string, Name> => {
      if (!isUuid(value)) {
        throw new TypeError(`Invalid ${entityName}: "${value}" is not a UUID`);
      }
      return value as Brand<string, Name>;
    },
    is: (value: unknown): value is Brand<string, Name> =>
      typeof value === 'string' && isUuid(value),
  };
}

export type UserId = Brand<string, 'UserId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type ProductVariantId = Brand<string, 'ProductVariantId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type CartId = Brand<string, 'CartId'>;
export type StoreId = Brand<string, 'StoreId'>;
export type WarehouseId = Brand<string, 'WarehouseId'>;
export type PrescriptionId = Brand<string, 'PrescriptionId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type PermissionId = Brand<string, 'PermissionId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type ApiKeyId = Brand<string, 'ApiKeyId'>;
// Phase 005 — catalog (see docs/adr/ADR-005-catalog-architecture.md).
export type BrandId = Brand<string, 'BrandId'>;
export type CategoryId = Brand<string, 'CategoryId'>;
export type CollectionId = Brand<string, 'CollectionId'>;
export type ProductSkuId = Brand<string, 'ProductSkuId'>;
export type MediaId = Brand<string, 'MediaId'>;
export type ProductAttributeId = Brand<string, 'ProductAttributeId'>;
export type ProductAttributeValueId = Brand<string, 'ProductAttributeValueId'>;
// Phase 006 — inventory/warehouse (see docs/adr/ADR-006-inventory-architecture.md).
export type WarehouseLocationId = Brand<string, 'WarehouseLocationId'>;
export type InventoryItemId = Brand<string, 'InventoryItemId'>;
export type InventoryThresholdId = Brand<string, 'InventoryThresholdId'>;
export type InventoryLedgerId = Brand<string, 'InventoryLedgerId'>;
export type InventoryReservationId = Brand<string, 'InventoryReservationId'>;
export type StockTransferId = Brand<string, 'StockTransferId'>;
export type StockTransferItemId = Brand<string, 'StockTransferItemId'>;
export type InventoryAdjustmentId = Brand<string, 'InventoryAdjustmentId'>;
export type StockCountId = Brand<string, 'StockCountId'>;
export type StockCountItemId = Brand<string, 'StockCountItemId'>;
// Phase 007 — cart/checkout (see docs/adr/ADR-007-cart-checkout.md).
export type CartItemId = Brand<string, 'CartItemId'>;
export type CartItemOptionId = Brand<string, 'CartItemOptionId'>;
export type CartPriceSnapshotId = Brand<string, 'CartPriceSnapshotId'>;
export type CartCouponId = Brand<string, 'CartCouponId'>;
export type CartShippingSelectionId = Brand<string, 'CartShippingSelectionId'>;
export type ShippingMethodId = Brand<string, 'ShippingMethodId'>;
export type CheckoutSessionId = Brand<string, 'CheckoutSessionId'>;
export type CheckoutAddressId = Brand<string, 'CheckoutAddressId'>;
export type CheckoutTotalsId = Brand<string, 'CheckoutTotalsId'>;
export type CheckoutValidationResultId = Brand<string, 'CheckoutValidationResultId'>;
export type CheckoutReservationId = Brand<string, 'CheckoutReservationId'>;
// Phase 008 — payment orchestration (see docs/adr/ADR-008-payment-orchestration.md).
export type PaymentProviderId = Brand<string, 'PaymentProviderId'>;
export type PaymentIntentId = Brand<string, 'PaymentIntentId'>;
export type PaymentAttemptId = Brand<string, 'PaymentAttemptId'>;
export type PaymentTransactionId = Brand<string, 'PaymentTransactionId'>;
export type PaymentCallbackId = Brand<string, 'PaymentCallbackId'>;
export type RefundId = Brand<string, 'RefundId'>;
export type ReconciliationRecordId = Brand<string, 'ReconciliationRecordId'>;

export const asUserId = brandedId<'UserId'>('UserId').as;
export const asCustomerId = brandedId<'CustomerId'>('CustomerId').as;
export const asProductId = brandedId<'ProductId'>('ProductId').as;
export const asProductVariantId = brandedId<'ProductVariantId'>('ProductVariantId').as;
export const asOrderId = brandedId<'OrderId'>('OrderId').as;
export const asCartId = brandedId<'CartId'>('CartId').as;
export const asStoreId = brandedId<'StoreId'>('StoreId').as;
export const asWarehouseId = brandedId<'WarehouseId'>('WarehouseId').as;
export const asPrescriptionId = brandedId<'PrescriptionId'>('PrescriptionId').as;
export const asRoleId = brandedId<'RoleId'>('RoleId').as;
export const asPermissionId = brandedId<'PermissionId'>('PermissionId').as;
export const asSessionId = brandedId<'SessionId'>('SessionId').as;
export const asDeviceId = brandedId<'DeviceId'>('DeviceId').as;
export const asApiKeyId = brandedId<'ApiKeyId'>('ApiKeyId').as;
export const asBrandId = brandedId<'BrandId'>('BrandId').as;
export const asCategoryId = brandedId<'CategoryId'>('CategoryId').as;
export const asCollectionId = brandedId<'CollectionId'>('CollectionId').as;
export const asProductSkuId = brandedId<'ProductSkuId'>('ProductSkuId').as;
export const asMediaId = brandedId<'MediaId'>('MediaId').as;
export const asProductAttributeId = brandedId<'ProductAttributeId'>('ProductAttributeId').as;
export const asProductAttributeValueId =
  brandedId<'ProductAttributeValueId'>('ProductAttributeValueId').as;
export const asWarehouseLocationId = brandedId<'WarehouseLocationId'>('WarehouseLocationId').as;
export const asInventoryItemId = brandedId<'InventoryItemId'>('InventoryItemId').as;
export const asInventoryThresholdId = brandedId<'InventoryThresholdId'>('InventoryThresholdId').as;
export const asInventoryLedgerId = brandedId<'InventoryLedgerId'>('InventoryLedgerId').as;
export const asInventoryReservationId =
  brandedId<'InventoryReservationId'>('InventoryReservationId').as;
export const asStockTransferId = brandedId<'StockTransferId'>('StockTransferId').as;
export const asStockTransferItemId = brandedId<'StockTransferItemId'>('StockTransferItemId').as;
export const asInventoryAdjustmentId =
  brandedId<'InventoryAdjustmentId'>('InventoryAdjustmentId').as;
export const asStockCountId = brandedId<'StockCountId'>('StockCountId').as;
export const asStockCountItemId = brandedId<'StockCountItemId'>('StockCountItemId').as;
export const asCartItemId = brandedId<'CartItemId'>('CartItemId').as;
export const asCartItemOptionId = brandedId<'CartItemOptionId'>('CartItemOptionId').as;
export const asCartPriceSnapshotId = brandedId<'CartPriceSnapshotId'>('CartPriceSnapshotId').as;
export const asCartCouponId = brandedId<'CartCouponId'>('CartCouponId').as;
export const asCartShippingSelectionId =
  brandedId<'CartShippingSelectionId'>('CartShippingSelectionId').as;
export const asShippingMethodId = brandedId<'ShippingMethodId'>('ShippingMethodId').as;
export const asCheckoutSessionId = brandedId<'CheckoutSessionId'>('CheckoutSessionId').as;
export const asCheckoutAddressId = brandedId<'CheckoutAddressId'>('CheckoutAddressId').as;
export const asCheckoutTotalsId = brandedId<'CheckoutTotalsId'>('CheckoutTotalsId').as;
export const asCheckoutValidationResultId = brandedId<'CheckoutValidationResultId'>(
  'CheckoutValidationResultId',
).as;
export const asCheckoutReservationId =
  brandedId<'CheckoutReservationId'>('CheckoutReservationId').as;
export const asPaymentProviderId = brandedId<'PaymentProviderId'>('PaymentProviderId').as;
export const asPaymentIntentId = brandedId<'PaymentIntentId'>('PaymentIntentId').as;
export const asPaymentAttemptId = brandedId<'PaymentAttemptId'>('PaymentAttemptId').as;
export const asPaymentTransactionId = brandedId<'PaymentTransactionId'>('PaymentTransactionId').as;
export const asPaymentCallbackId = brandedId<'PaymentCallbackId'>('PaymentCallbackId').as;
export const asRefundId = brandedId<'RefundId'>('RefundId').as;
export const asReconciliationRecordId =
  brandedId<'ReconciliationRecordId'>('ReconciliationRecordId').as;
// Phase 009 — order/invoice/fulfillment/shipment (see docs/adr/ADR-009-order-fulfillment.md).
export type OrderItemId = Brand<string, 'OrderItemId'>;
export type OrderStatusHistoryId = Brand<string, 'OrderStatusHistoryId'>;
export type InvoiceId = Brand<string, 'InvoiceId'>;
export type InvoiceItemId = Brand<string, 'InvoiceItemId'>;
export type FulfillmentId = Brand<string, 'FulfillmentId'>;
export type FulfillmentItemId = Brand<string, 'FulfillmentItemId'>;
export type ShipmentId = Brand<string, 'ShipmentId'>;
export type ShipmentEventId = Brand<string, 'ShipmentEventId'>;

export const asOrderItemId = brandedId<'OrderItemId'>('OrderItemId').as;
export const asOrderStatusHistoryId = brandedId<'OrderStatusHistoryId'>('OrderStatusHistoryId').as;
export const asInvoiceId = brandedId<'InvoiceId'>('InvoiceId').as;
export const asInvoiceItemId = brandedId<'InvoiceItemId'>('InvoiceItemId').as;
export const asFulfillmentId = brandedId<'FulfillmentId'>('FulfillmentId').as;
export const asFulfillmentItemId = brandedId<'FulfillmentItemId'>('FulfillmentItemId').as;
export const asShipmentId = brandedId<'ShipmentId'>('ShipmentId').as;
export const asShipmentEventId = brandedId<'ShipmentEventId'>('ShipmentEventId').as;
