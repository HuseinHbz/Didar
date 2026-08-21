import type {
  FulfillmentStatus as SharedFulfillmentStatus,
  OrderFulfillmentStatus,
  OrderPaymentStatus,
  OrderStatus,
} from '@iecp/types';

import { apiRequest } from './client';

export type { OrderFulfillmentStatus, OrderPaymentStatus, OrderStatus };

export interface OrderItem {
  id: string;
  productSkuId: string | null;
  skuSnapshot: string;
  nameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string | null;
  source: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  fulfillmentStatus: OrderFulfillmentStatus;
  grandTotal: string;
  paidTotal: string;
  refundedTotal: string;
  placedAt: string;
  items: OrderItem[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export async function listOrders(params: {
  status?: OrderStatus;
  cursor?: string;
  limit?: number;
}): Promise<Page<Order>> {
  return apiRequest<Page<Order>>('/admin/orders', { query: params });
}

export async function getOrder(id: string): Promise<Order> {
  return apiRequest<Order>(`/admin/orders/${id}`);
}

export async function approveOrder(id: string): Promise<Order> {
  return apiRequest<Order>(`/admin/orders/${id}/approve`, { method: 'POST' });
}

export async function completeOrder(id: string): Promise<Order> {
  return apiRequest<Order>(`/admin/orders/${id}/complete`, { method: 'POST' });
}

export async function cancelOrder(id: string, reason?: string): Promise<Order> {
  return apiRequest<Order>(`/admin/orders/${id}/cancel`, { method: 'POST', body: { reason } });
}

export async function refundOrder(id: string, amount: number, reason?: string): Promise<Order> {
  return apiRequest<Order>(`/admin/orders/${id}/refund`, {
    method: 'POST',
    body: { amount, reason },
  });
}

export type FulfillmentStatus = SharedFulfillmentStatus;

export interface Shipment {
  id: string;
  carrier: string | null;
  trackingNumber: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface Fulfillment {
  id: string;
  orderId: string;
  status: FulfillmentStatus;
  warehouseId: string | null;
  items: { id: string; orderItemId: string; quantity: number }[];
  shipment: Shipment | null;
}

/** `FulfillmentAdminController` is nested under `admin/orders/:orderId`
 * (ADR-009/011) — every route below takes the parent order id, never a
 * flat top-level fulfillment/shipment resource. */
export async function listFulfillments(orderId: string): Promise<Fulfillment[]> {
  return apiRequest<Fulfillment[]>(`/admin/orders/${orderId}/fulfillments`);
}

export async function createFulfillment(
  orderId: string,
  items: { orderItemId: string; quantity: number }[],
): Promise<Fulfillment> {
  return apiRequest<Fulfillment>(`/admin/orders/${orderId}/fulfillments`, {
    method: 'POST',
    body: { items },
  });
}

export async function createShipment(
  orderId: string,
  fulfillmentId: string,
  carrier?: string,
  trackingNumber?: string,
): Promise<Shipment> {
  return apiRequest<Shipment>(`/admin/orders/${orderId}/fulfillments/${fulfillmentId}/shipments`, {
    method: 'POST',
    body: { carrier, trackingNumber },
  });
}

export async function deliverShipment(orderId: string, shipmentId: string): Promise<Shipment> {
  return apiRequest<Shipment>(`/admin/orders/${orderId}/shipments/${shipmentId}/deliver`, {
    method: 'POST',
  });
}
