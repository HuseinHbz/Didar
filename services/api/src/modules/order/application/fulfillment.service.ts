import { randomUUID } from 'node:crypto';

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
 * Fulfillment + shipment operations (ADR-009 decisions 8/12, hardened by
 * ADR-011). Every fulfillment/shipment status change re-derives
 * `Order.fulfillmentStatus` and, where the order's own `OrderStateMachine`
 * allows it, `Order.status` itself — always from the fulfillment
 * aggregate's own real state, never a value passed in by a caller.
 *
 * `updateStatus()`/`updateShipmentStatus()` only write an audit-log entry
 * (and, for fulfillment, only re-sync the order) when the repository
 * reports `transitioned: true` — a losing racer under
 * `PrismaFulfillmentRepository`'s row-locked re-check (ADR-011 decision 1)
 * resolves to the same no-op the state machine already treats it as, and
 * must never produce a phantom audit-log entry for a transition that
 * didn't actually happen.
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

  async findShipmentByTrackingNumber(trackingNumber: string): Promise<Shipment | null> {
    return this.fulfillments.findShipmentByTrackingNumber(trackingNumber);
  }

  /** `POST /admin/orders/:id/fulfillments` — the order must already be
   * `READY_TO_FULFILL`/`PARTIALLY_FULFILLED` (a `PAID`/unapproved order
   * can't be fulfilled out of order); the over-fulfillment invariant
   * itself is enforced transactionally by the repository
   * (`FulfillmentRepositoryPort.create()`, ADR-009 decision 8), not here.
   * `idempotencyKey`, when supplied, makes a retried request resolve to
   * the original fulfillment instead of creating a second, real duplicate
   * (ADR-011 decision 2) — auto-generated when the caller doesn't supply
   * one, so every fulfillment still gets one for free.
   */
  async create(
    orderId: string,
    actorUserId: string,
    props: {
      warehouseId?: string | null;
      items: readonly { orderItemId: string; quantity: number }[];
      idempotencyKey?: string | null;
    },
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
      idempotencyKey: props.idempotencyKey ?? randomUUID(),
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
    status: Exclude<Parameters<FulfillmentRepositoryPort['updateStatus']>[1], 'DELIVERED'>,
  ): Promise<Fulfillment> {
    if ((status as string) === 'DELIVERED') {
      // ADR-011 decision 4 — a fulfillment only ever reaches DELIVERED
      // via its shipment's own dedicated confirmDelivery() cascade
      // (updateFulfillmentToDelivered(), private below), never a direct
      // PATCH — otherwise the shipment-delivery permission boundary
      // would be trivially bypassable through this generic route.
      throw new ForbiddenException(
        'A fulfillment can only reach DELIVERED via its shipment’s delivery confirmation',
      );
    }
    const detail = await this.get(fulfillmentId);
    if (!FulfillmentStateMachine.isNoOp(detail.fulfillment.status, status)) {
      FulfillmentStateMachine.assertTransition(detail.fulfillment.status, status);
    }

    const now = new Date();
    const { entity: updated, transitioned } = await this.fulfillments.updateStatus(
      fulfillmentId,
      status,
      {
        packedAt: status === 'PACKED' ? now : undefined,
        shippedAt: status === 'SHIPPED' ? now : undefined,
        cancelledAt: status === 'CANCELLED' ? now : undefined,
      },
    );

    if (transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'FULFILLMENT_STATUS_CHANGED',
        entityType: 'Fulfillment',
        entityId: fulfillmentId,
        oldValue: { status: detail.fulfillment.status },
        newValue: { status },
      });
      if (status === 'CANCELLED') {
        await this.syncOrderFulfillmentState(updated.orderId, actorUserId);
      }
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

  /** `PATCH /admin/orders/:id/shipments/:shipmentId` (`order.shipment.update`).
   * Structurally rejects `DELIVERED` as a target (ADR-011 decision 4) —
   * delivery confirmation is only reachable through the dedicated
   * `confirmDelivery()` method / route below, gated by its own
   * `order.shipment.deliver` permission and its own audit action. */
  async updateShipmentStatus(
    shipmentId: string,
    actorUserId: string,
    status: Exclude<Parameters<FulfillmentRepositoryPort['updateShipmentStatus']>[1], 'DELIVERED'>,
    location?: string | null,
  ): Promise<ShipmentEvent> {
    if ((status as string) === 'DELIVERED') {
      throw new ForbiddenException(
        'Delivery confirmation must use the dedicated deliver route, not a generic status update',
      );
    }
    const shipment = await this.fulfillments.findShipmentById(shipmentId);
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (!ShipmentStateMachine.isNoOp(shipment.status, status)) {
      ShipmentStateMachine.assertTransition(shipment.status, status);
    }

    const now = new Date();
    const { transitioned } = await this.fulfillments.updateShipmentStatus(shipmentId, status, {
      shippedAt: status === 'IN_TRANSIT' ? now : undefined,
    });
    const event = await this.fulfillments.addShipmentEvent(shipmentId, {
      status,
      location,
      source: 'MANUAL_ADMIN',
    });
    if (transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'SHIPMENT_STATUS_CHANGED',
        entityType: 'Shipment',
        entityId: shipmentId,
        oldValue: { status: shipment.status },
        newValue: { status, location: location ?? null },
      });
    }
    return event;
  }

  /** `POST /admin/orders/:id/shipments/:shipmentId/deliver`
   * (`order.shipment.deliver`, ADR-011 decision 4) — the one route that
   * can transition a shipment to `DELIVERED`, deliberately separate from
   * `updateShipmentStatus()`: delivery is the fact that can gate order
   * completion (`OrderCompletionValidator`), so it gets its own
   * permission boundary and its own audit action (`SHIPMENT_DELIVERED`)
   * rather than being folded into the generic status-update permission.
   * Idempotent (`ShipmentStateMachine.isNoOp`) and concurrency-safe (the
   * same row-locked repository method every other transition uses) —
   * confirming delivery twice, concurrently or sequentially, never
   * double-writes. Also drives the shipment's own `Fulfillment` to
   * `DELIVERED`, which in turn re-syncs `Order.fulfillmentStatus`. */
  async confirmDelivery(shipmentId: string, actorUserId: string): Promise<ShipmentEvent> {
    const shipment = await this.fulfillments.findShipmentById(shipmentId);
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (!ShipmentStateMachine.isNoOp(shipment.status, 'DELIVERED')) {
      ShipmentStateMachine.assertTransition(shipment.status, 'DELIVERED');
    }

    const now = new Date();
    const { transitioned } = await this.fulfillments.updateShipmentStatus(shipmentId, 'DELIVERED', {
      deliveredAt: now,
    });
    const event = await this.fulfillments.addShipmentEvent(shipmentId, {
      status: 'DELIVERED',
      source: 'MANUAL_ADMIN',
    });

    if (transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'SHIPMENT_DELIVERED',
        entityType: 'Shipment',
        entityId: shipmentId,
        oldValue: { status: shipment.status },
        newValue: { status: 'DELIVERED' },
      });
      await this.updateFulfillmentToDelivered(shipment.fulfillmentId, actorUserId);
    }
    return event;
  }

  /** Internal — a delivered shipment *is* its fulfillment being delivered
   * (there is no meaningful "shipment delivered but fulfillment still
   * SHIPPED" state), so `confirmDelivery()` drives this directly rather
   * than going back through the public `updateStatus()` (which would
   * otherwise re-run a redundant app-layer pre-check against data already
   * known to be stale-safe here). */
  private async updateFulfillmentToDelivered(
    fulfillmentId: string,
    actorUserId: string,
  ): Promise<void> {
    const before = await this.fulfillments.findById(fulfillmentId);
    if (!before) return;
    if (FulfillmentStateMachine.isNoOp(before.fulfillment.status, 'DELIVERED')) return;

    const { entity: updated, transitioned } = await this.fulfillments.updateStatus(
      fulfillmentId,
      'DELIVERED',
      { deliveredAt: new Date() },
    );
    if (transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'FULFILLMENT_STATUS_CHANGED',
        entityType: 'Fulfillment',
        entityId: fulfillmentId,
        oldValue: { status: before.fulfillment.status },
        newValue: { status: 'DELIVERED' },
      });
      await this.syncOrderFulfillmentState(updated.orderId, actorUserId);
    }
  }
}
