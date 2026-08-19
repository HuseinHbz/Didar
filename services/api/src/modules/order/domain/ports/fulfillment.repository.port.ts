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
   */
  create(props: {
    orderId: string;
    warehouseId?: string | null;
    items: readonly { orderItemId: string; quantity: number }[];
  }): Promise<Fulfillment>;

  updateStatus(
    id: string,
    status: FulfillmentStatus,
    extra?: { packedAt?: Date; shippedAt?: Date; deliveredAt?: Date; cancelledAt?: Date },
  ): Promise<Fulfillment>;

  /** Idempotent on `fulfillmentId` (`@unique`, one shipment per
   * fulfillment) — a duplicate creation attempt resolves to the existing
   * row via the same P2002-catch-and-reread pattern. */
  createShipment(
    fulfillmentId: string,
    props: { carrier?: string | null; trackingNumber?: string | null },
  ): Promise<Shipment>;

  updateShipmentStatus(
    shipmentId: string,
    status: ShipmentStatus,
    extra?: { shippedAt?: Date; deliveredAt?: Date },
  ): Promise<Shipment>;

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
