/**
 * Shared shapes for Phase 009's order/fulfillment/shipment domain — see
 * `docs/adr/ADR-009-order-fulfillment.md`. `ShippingProvider`'s return
 * contracts (decision 12) mirror `PaymentProviderAdapter`'s own shape:
 * the domain layer depends on these, the infrastructure layer's
 * `ManualShippingProvider` produces them, and tests assert against them —
 * one canonical definition instead of three drifting copies.
 */

/** `ShippingProvider.createShipment()`. */
export interface ShippingProviderCreateResult {
  providerShipmentReference: string | null;
  trackingNumber: string | null;
}

/** `ShippingProvider.getShipmentStatus()`. */
export interface ShippingProviderStatusResult {
  status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
  location?: string | null;
  occurredAt: Date;
}

/** `ShippingProvider.cancelShipment()`. */
export interface ShippingProviderCancelResult {
  cancelled: boolean;
}
