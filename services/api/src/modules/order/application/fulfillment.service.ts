import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { Fulfillment } from '../domain/entities/fulfillment.entity';
import type { ShipmentEvent } from '../domain/entities/shipment-event.entity';
import type { Shipment } from '../domain/entities/shipment.entity';
import {
  FULFILLMENT_REPOSITORY,
  type FulfillmentRepositoryPort,
  type FulfillmentWithDetail,
} from '../domain/ports/fulfillment.repository.port';
import { ORDER_REPOSITORY, type OrderRepositoryPort } from '../domain/ports/order.repository.port';
import { SHIPPING_PROVIDER, type ShippingProvider } from '../domain/ports/shipping-provider.port';
import { FulfillmentStateMachine } from '../domain/services/fulfillment-state-machine';
import { OrderStateMachine } from '../domain/services/order-state-machine';
import { ShipmentStateMachine } from '../domain/services/shipment-state-machine';

/**
 * Fulfillment + shipment operations (ADR-009 decisions 8/12). Every
 * fulfillment/shipment status change re-derives `Order.fulfillmentStatus`
 * and, where the order's own `OrderStateMachine` allows it,
 * `Order.status` itself — always from the fulfillment aggregate's own
 * real state, never a value passed in by a caller.
 */
@Injectable()
export class FulfillmentService {
  constructor(
    @Inject(FULFILLMENT_REPOSITORY) private readonly fulfillments: FulfillmentRepositoryPort,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepositoryPort,
    @Inject(SHIPPING_PROVIDER) private readonly shippingProvider: ShippingProvider,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async get(fulfillmentId: string): Promise<FulfillmentWithDetail> {
    const detail = await this.fulfillments.findById(fulfillmentId);
    if (!detail) throw new NotFoundException('Fulfillment not found');
    return detail;
  }

  async listByOrder(orderId: string): Promise<FulfillmentWithDetail[]> {
    return this.fulfillments.listByOrderId(orderId);
  }

  /** `POST /admin/orders/:id/fulfillments` — the order must already be
   * `READY_TO_FULFILL`/`PARTIALLY_FULFILLED` (a `PAID`/unapproved order
   * can't be fulfilled out of order); the over-fulfillment invariant
   * itself is enforced transactionally by the repository
   * (`FulfillmentRepositoryPort.create()`, ADR-009 decision 8), not here.
   */
  async create(
    orderId: string,
    actorUserId: string,
    props: { warehouseId?: string | null; items: readonly { orderItemId: string; quantity: number }[] },
  ): Promise<Fulfillment> {
    const orderDetail = await this.orders.findById(orderId);
    if (!orderDetail) throw new NotFoundException('Order not found');
    if (
      orderDetail.order.status !== 'READY_TO_FULFILL' &&
      orderDetail.order.status !== 'PARTIALLY_FULFILLED'
    ) {
      throw new ForbiddenException(
        `Order ${orderId} is not ready to fulfill (status: ${orderDetail.order.status})`,
      );
    }

    const fulfillment = await this.fulfillments.create({
      orderId,
      warehouseId: props.warehouseId,
      items: props.items,
    });

    await this.auditLog.record({
      actorId: actorUserId,
      action: 'FULFILLMENT_CREATED',
      entityType: 'Fulfillment',
      entityId: fulfillment.id,
      newValue: { orderId, items: props.items },
    });

    await this.syncOrderFulfillmentState(orderId, actorUserId);
    return fulfillment;
  }

  /** Re-derives `Order.fulfillmentStatus` from real `FulfillmentItem`
   * sums across every non-`CANCELLED` `Fulfillment`, and advances
   * `Order.status` to `PARTIALLY_FULFILLED`/`FULFILLED` where the state
   * machine allows it — never independently tracked (ADR-009 decision 3). */
  private async syncOrderFulfillmentState(orderId: string, actorUserId: string): Promise<void> {
    const orderDetail = await this.orders.findById(orderId);
    if (!orderDetail) return;

    let totalOrdered = 0;
    let totalFulfilled = 0;
    for (const item of orderDetail.items) {
      totalOrdered += item.quantity;
      totalFulfilled += await this.fulfillments.sumFulfilledQuantity(item.id);
    }

    const fulfillmentStatus =
      totalFulfilled === 0
        ? 'UNFULFILLED'
        : totalFulfilled >= totalOrdered
          ? 'FULFILLED'
          : 'PARTIALLY_FULFILLED';
    await this.orders.updateFulfillmentStatus(orderId, fulfillmentStatus);

    const nextOrderStatus = fulfillmentStatus === 'FULFILLED' ? 'FULFILLED' : 'PARTIALLY_FULFILLED';
    if (OrderStateMachine.canTransition(orderDetail.order.status, nextOrderStatus)) {
      await this.orders.updateStatus(orderId, nextOrderStatus, actorUserId);
    }
  }

  /** `PATCH /admin/orders/:id/fulfillments/:fulfillmentId` — status only;
   * quantities are fixed once a `Fulfillment` is created (ADR-009's own
   * scope — no partial-item correction mechanic this phase). */
  async updateStatus(
    fulfillmentId: string,
    actorUserId: string,
    status: Parameters<FulfillmentRepositoryPort['updateStatus']>[1],
  ): Promise<Fulfillment> {
    const detail = await this.get(fulfillmentId);
    if (FulfillmentStateMachine.isNoOp(detail.fulfillment.status, status)) {
      return detail.fulfillment;
    }
    FulfillmentStateMachine.assertTransition(detail.fulfillment.status, status);

    const now = new Date();
    const updated = await this.fulfillments.updateStatus(fulfillmentId, status, {
      packedAt: status === 'PACKED' ? now : undefined,
      shippedAt: status === 'SHIPPED' ? now : undefined,
      deliveredAt: status === 'DELIVERED' ? now : undefined,
      cancelledAt: status === 'CANCELLED' ? now : undefined,
    });

    await this.auditLog.record({
      actorId: actorUserId,
      action: 'FULFILLMENT_STATUS_CHANGED',
      entityType: 'Fulfillment',
      entityId: fulfillmentId,
      oldValue: { status: detail.fulfillment.status },
      newValue: { status },
    });

    if (status === 'CANCELLED') {
      await this.syncOrderFulfillmentState(detail.fulfillment.orderId, actorUserId);
    }
    return updated;
  }

  /** `POST /admin/orders/:id/fulfillments/:fulfillmentId/shipments` —
   * idempotent on `fulfillmentId` (repository-level P2002-catch-and-reread).
   * Calls the real `ShippingProvider` boundary (`ManualShippingProvider`
   * this phase) before persisting, same "the adapter is the boundary"
   * shape `PaymentProviderAdapter` established. */
  async createShipment(
    fulfillmentId: string,
    actorUserId: string,
    props: { carrier?: string | null; trackingNumber?: string | null },
  ): Promise<Shipment> {
    await this.get(fulfillmentId); // 404s if the fulfillment doesn't exist
    await this.shippingProvider.createShipment({
      fulfillmentId,
      carrier: props.carrier,
      trackingNumber: props.trackingNumber,
      recipientAddress: {},
    });

    const shipment = await this.fulfillments.createShipment(fulfillmentId, props);
    await this.fulfillments.addShipmentEvent(shipment.id, {
      status: shipment.status,
      source: 'MANUAL_ADMIN',
    });
    await this.auditLog.record({
      actorId: actorUserId,
      action: 'SHIPMENT_CREATED',
      entityType: 'Shipment',
      entityId: shipment.id,
      newValue: { fulfillmentId, carrier: props.carrier, trackingNumber: props.trackingNumber },
    });
    return shipment;
  }

  /** `PATCH /admin/orders/:id/shipments/:shipmentId` — a `DELIVERED`
   * shipment also drives its own `Fulfillment` to `DELIVERED` (a
   * delivered shipment *is* the fulfillment being delivered — there is no
   * meaningful "shipment delivered but fulfillment still SHIPPED" state),
   * which in turn re-syncs `Order.fulfillmentStatus`. */
  async updateShipmentStatus(
    shipmentId: string,
    actorUserId: string,
    status: Parameters<FulfillmentRepositoryPort['updateShipmentStatus']>[1],
    location?: string | null,
  ): Promise<ShipmentEvent> {
    const shipment = await this.fulfillments.findShipmentById(shipmentId);
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (!ShipmentStateMachine.isNoOp(shipment.status, status)) {
      ShipmentStateMachine.assertTransition(shipment.status, status);
    }

    const now = new Date();
    await this.fulfillments.updateShipmentStatus(shipmentId, status, {
      shippedAt: status === 'IN_TRANSIT' ? now : undefined,
      deliveredAt: status === 'DELIVERED' ? now : undefined,
    });
    const event = await this.fulfillments.addShipmentEvent(shipmentId, {
      status,
      location,
      source: 'MANUAL_ADMIN',
    });
    await this.auditLog.record({
      actorId: actorUserId,
      action: 'SHIPMENT_STATUS_CHANGED',
      entityType: 'Shipment',
      entityId: shipmentId,
      oldValue: { status: shipment.status },
      newValue: { status, location: location ?? null },
    });

    if (status === 'DELIVERED') {
      await this.updateStatus(shipment.fulfillmentId, actorUserId, 'DELIVERED');
    }
    return event;
  }
}
