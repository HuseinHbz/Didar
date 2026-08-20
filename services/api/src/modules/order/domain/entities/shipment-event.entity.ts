import {
  asShipmentEventId,
  asShipmentId,
  type ShipmentEventId,
  type ShipmentId,
  type ShipmentStatus,
} from '@iecp/types';

/** Append-only tracking history. `source` is a plain string (not an enum)
 * since no live courier webhook exists yet to give it a real closed
 * vocabulary — always `"MANUAL_ADMIN"` or `"SYSTEM"` in this phase. */
export class ShipmentEvent {
  private constructor(
    public readonly id: ShipmentEventId,
    public readonly shipmentId: ShipmentId,
    public readonly status: ShipmentStatus,
    public readonly location: string | null,
    public readonly details: Record<string, unknown> | null,
    public readonly source: string,
    public readonly occurredAt: Date,
  ) {}

  static create(props: {
    id: string;
    shipmentId: string;
    status: ShipmentStatus;
    location?: string | null;
    details?: Record<string, unknown> | null;
    source?: string;
    occurredAt: Date;
  }): ShipmentEvent {
    return new ShipmentEvent(
      asShipmentEventId(props.id),
      asShipmentId(props.shipmentId),
      props.status,
      props.location ?? null,
      props.details ?? null,
      props.source ?? 'MANUAL_ADMIN',
      props.occurredAt,
    );
  }
}
