export const INVENTORY_EVENT_PUBLISHER = Symbol('INVENTORY_EVENT_PUBLISHER');

/** The exact `events.publish` set from the brief. */
export type InventoryEventName =
  | 'inventory_reserved'
  | 'inventory_reservation_released'
  | 'inventory_reservation_expired'
  | 'inventory_transfer_created'
  | 'inventory_transfer_dispatched'
  | 'inventory_transfer_received'
  | 'inventory_adjusted'
  | 'inventory_low_stock';

/** Publishes an inventory domain event — the BullMQ-backed implementation
 * (`InventoryEventsQueueService`) enqueues it for asynchronous, logged
 * processing; a unit test can substitute a no-op/recording fake without
 * pulling in Redis (this port is what keeps the application layer free of
 * an `infrastructure/queues` import). Never a second source of truth —
 * every payload field also lives in `inventory_ledger` or the entity's own
 * row (ADR-006's own events rule). */
export interface InventoryEventPublisherPort {
  publish(
    event: InventoryEventName,
    correlationId: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
}
