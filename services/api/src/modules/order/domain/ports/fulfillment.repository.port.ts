import type { FulfillmentStatus, ShipmentStatus } from '@iecp/types';

import type { FulfillmentItem } from '../entities/fulfillment-item.entity';
import type { Fulfillment } from '../entities/fulfillment.entity';
import type { ShipmentEvent } from '../entities/shipment-event.entity';
import type { Shipment } from '../entities/shipment.entity';

export const FULFILLMENT_REPOSITORY = Symbol('FULFILLMENT_REPOSITORY');

export interface FulfillmentWithDetail {
  fulfillment: Fulfillment;
  items: FulfillmentItem[];
  shipment: Shipment | null;
  shipmentEvents: ShipmentEvent[];
}

/** `transitioned: false` means the locked, authoritative check found the
 * row already at the target status (a race-resolved no-op, ADR-011
 * decision 1) — the caller must skip audit-logging/side-effects it would
 * otherwise perform, so a losing racer never produces a phantom
 * `system.AuditLog` entry for a transition that didn't actually happen. */
export interface StatusUpdateResult<T> {
  entity: T;
  transitioned: boolean;
}

/** `Fulfillment` is the aggregate root for `FulfillmentItem` and its
 * (at most one) `Shipment` + that shipment's `ShipmentEvent` history —
 * same "child entities with no independent lifecycle" reasoning every
 * other aggregate root in this repo uses. */
export interface FulfillmentRepositoryPort {
  findById(id: string): Promise<FulfillmentWithDetail | null>;
  listByOrderId(orderId: string): Promise<FulfillmentWithDetail[]>;
  findShipmentById(id: string): Promise<Shipment | null>;

  /** Every quantity fulfilled for `orderItemId` across every
   * non-`CANCELLED` `Fulfillment` — read-only visibility into the
   * invariant `create()` enforces transactionally. */
  sumFulfilledQuantity(orderItemId: string): Promise<number>;

  /**
   * Row-locks each referenced `OrderItem` (`SELECT ... FOR UPDATE`, the
   * same technique `mutateInventoryItem` established), re-sums
   * already-fulfilled quantity inside that same transaction, and asserts
   * via `FulfillmentQuantityValidator` before writing — the real
   * concurrency-safety guarantee ADR-009 decision 8 requires, not just a
   * declared one.
   *
   * `idempotencyKey`, when supplied (ADR-011 decision 2), is P2002-catch-
   * and-reread safe — a retried "create this fulfillment" request reusing
   * the same key resolves to the original row rather than creating a
   * second, real duplicate fulfillment.
   */
  create(props: {
    orderId: string;
    warehouseId?: string | null;
    items: readonly { orderItemId: string; quantity: number }[];
    idempotencyKey?: string | null;
  }): Promise<Fulfillment>;

  /**
   * ADR-011 decision 1 — row-locks `commerce.fulfillments` (`SELECT ...
   * FOR UPDATE`) and re-checks `FulfillmentStateMachine` against the
   * *locked* status before writing, the same technique
   * `PrismaOrderRepository.updateStatus()` already proved on `Order`.
   * `transitioned: false` on the returned `StatusUpdateResult` means a
   * concurrent caller already made this exact transition first.
   */
  updateStatus(
    id: string,
    status: FulfillmentStatus,
    extra?: { packedAt?: Date; shippedAt?: Date; deliveredAt?: Date; cancelledAt?: Date },
  ): Promise<StatusUpdateResult<Fulfillment>>;

  /** Idempotent on `fulfillmentId` (`@unique`, one shipment per
   * fulfillment) — a duplicate creation attempt resolves to the existing
   * row via the same P2002-catch-and-reread pattern. */
  createShipment(
    fulfillmentId: string,
    props: { carrier?: string | null; trackingNumber?: string | null },
  ): Promise<Shipment>;

  /** ADR-011 decision 5 — admin-only tracking-number lookup; never a
   * customer-facing route. */
  findShipmentByTrackingNumber(trackingNumber: string): Promise<Shipment | null>;

  /** Same row-lock + re-check technique as `updateStatus()` above,
   * applied to `commerce.shipments` (ADR-011 decision 1). */
  updateShipmentStatus(
    shipmentId: string,
    status: ShipmentStatus,
    extra?: { shippedAt?: Date; deliveredAt?: Date },
  ): Promise<StatusUpdateResult<Shipment>>;

  addShipmentEvent(
    shipmentId: string,
    props: {
      status: ShipmentStatus;
      location?: string | null;
      details?: Record<string, unknown> | null;
      source?: string;
    },
  ): Promise<ShipmentEvent>;
}
