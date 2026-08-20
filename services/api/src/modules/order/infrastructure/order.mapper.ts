import type {
  Fulfillment as PrismaFulfillment,
  FulfillmentItem as PrismaFulfillmentItem,
  Invoice as PrismaInvoice,
  InvoiceItem as PrismaInvoiceItem,
  Order as PrismaOrder,
  OrderItem as PrismaOrderItem,
  OrderPromotion as PrismaOrderPromotion,
  OrderStatusHistory as PrismaOrderStatusHistory,
  Shipment as PrismaShipment,
  ShipmentEvent as PrismaShipmentEvent,
} from '@iecp/database';

import { FulfillmentItem } from '../domain/entities/fulfillment-item.entity';
import { Fulfillment } from '../domain/entities/fulfillment.entity';
import { InvoiceItem } from '../domain/entities/invoice-item.entity';
import { Invoice } from '../domain/entities/invoice.entity';
import { OrderItem } from '../domain/entities/order-item.entity';
import { OrderPromotion } from '../domain/entities/order-promotion.entity';
import { OrderStatusHistory } from '../domain/entities/order-status-history.entity';
import { Order } from '../domain/entities/order.entity';
import { ShipmentEvent } from '../domain/entities/shipment-event.entity';
import { Shipment } from '../domain/entities/shipment.entity';

export function orderToDomain(row: PrismaOrder): Order {
  return Order.create({
    id: row.id,
    orderNumber: row.orderNumber,
    checkoutSessionId: row.checkoutSessionId,
    paymentIntentId: row.paymentIntentId,
    customerId: row.customerId,
    guestToken: row.guestToken,
    source: row.source,
    status: row.status,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    currency: row.currency,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    shippingTotal: row.shippingTotal,
    grandTotal: row.grandTotal,
    paidTotal: row.paidTotal,
    refundedTotal: row.refundedTotal,
    shippingAddressSnapshot: row.shippingAddressSnapshot as Record<string, unknown>,
    billingAddressSnapshot: row.billingAddressSnapshot as Record<string, unknown> | null,
    placedAt: row.placedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cancelledAt: row.cancelledAt,
    completedAt: row.completedAt,
  });
}

export function orderItemToDomain(row: PrismaOrderItem): OrderItem {
  return OrderItem.create({
    id: row.id,
    orderId: row.orderId,
    productSkuId: row.productSkuId,
    skuSnapshot: row.skuSnapshot,
    nameSnapshot: row.nameSnapshot,
    unitPriceSnapshot: row.unitPriceSnapshot,
    quantity: row.quantity,
    discountAmount: row.discountAmount,
    taxAmount: row.taxAmount,
    lineTotal: row.lineTotal,
    createdAt: row.createdAt,
  });
}

export function orderPromotionToDomain(row: PrismaOrderPromotion): OrderPromotion {
  return OrderPromotion.create({
    id: row.id,
    orderId: row.orderId,
    promotionId: row.promotionId,
    promotionName: row.promotionName,
    couponId: row.couponId,
    couponCode: row.couponCode,
    discountType: row.discountType,
    discountAmount: row.discountAmount,
    affectedItemIds: row.affectedItemIds as string[],
    createdAt: row.createdAt,
  });
}

export function orderStatusHistoryToDomain(row: PrismaOrderStatusHistory): OrderStatusHistory {
  return OrderStatusHistory.create({
    id: row.id,
    orderId: row.orderId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    changedBy: row.changedBy,
    note: row.note,
    createdAt: row.createdAt,
  });
}

export function invoiceToDomain(row: PrismaInvoice): Invoice {
  return Invoice.create({
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    orderId: row.orderId,
    customerId: row.customerId,
    status: row.status,
    currency: row.currency,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    shippingTotal: row.shippingTotal,
    grandTotal: row.grandTotal,
    issuedAt: row.issuedAt,
    voidedAt: row.voidedAt,
    pdfUrl: row.pdfUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function invoiceItemToDomain(row: PrismaInvoiceItem): InvoiceItem {
  return InvoiceItem.create({
    id: row.id,
    invoiceId: row.invoiceId,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotal: row.lineTotal,
  });
}

export function fulfillmentToDomain(row: PrismaFulfillment): Fulfillment {
  return Fulfillment.create({
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    warehouseId: row.warehouseId,
    packedAt: row.packedAt,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function fulfillmentItemToDomain(row: PrismaFulfillmentItem): FulfillmentItem {
  return FulfillmentItem.create({
    id: row.id,
    fulfillmentId: row.fulfillmentId,
    orderItemId: row.orderItemId,
    quantity: row.quantity,
    createdAt: row.createdAt,
  });
}

export function shipmentToDomain(row: PrismaShipment): Shipment {
  return Shipment.create({
    id: row.id,
    fulfillmentId: row.fulfillmentId,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    status: row.status,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function shipmentEventToDomain(row: PrismaShipmentEvent): ShipmentEvent {
  return ShipmentEvent.create({
    id: row.id,
    shipmentId: row.shipmentId,
    status: row.status,
    location: row.location,
    details: row.details as Record<string, unknown> | null,
    source: row.source,
    occurredAt: row.occurredAt,
  });
}
