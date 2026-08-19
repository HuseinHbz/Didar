import {
  asFulfillmentId,
  asShipmentId,
  type FulfillmentId,
  type ShipmentId,
  type ShipmentStatus,
} from '@iecp/types';

/** One `Shipment` per `Fulfillment` (1:0..1, ADR-009 decision 12). No live
 * courier integration — `carrier`/`trackingNumber` are admin-entered via
 * `ManualShippingProvider`. */
export class Shipment {
  private constructor(
    public readonly id: ShipmentId,
    public readonly fulfillmentId: FulfillmentId,
    public readonly carrier: string | null,
    public readonly trackingNumber: string | null,
    public readonly status: ShipmentStatus,
    public readonly shippedAt: Date | null,
    public readonly deliveredAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    fulfillmentId: string;
    carrier?: string | null;
    trackingNumber?: string | null;
    status?: ShipmentStatus;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Shipment {
    return new Shipment(
      asShipmentId(props.id),
      asFulfillmentId(props.fulfillmentId),
      props.carrier ?? null,
      props.trackingNumber ?? null,
      props.status ?? 'PENDING',
      props.shippedAt ?? null,
      props.deliveredAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
