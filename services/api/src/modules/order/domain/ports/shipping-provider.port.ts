import type {
  ShippingProviderCancelResult,
  ShippingProviderCreateResult,
  ShippingProviderStatusResult,
} from '@iecp/types';

export const SHIPPING_PROVIDER = Symbol('SHIPPING_PROVIDER');

export class UnknownShipmentReferenceError extends Error {
  constructor(reference: string) {
    super(`Unknown shipment reference "${reference}"`);
    this.name = 'UnknownShipmentReferenceError';
  }
}

/**
 * The real shipment-provider-independence boundary (ADR-009 decision 12),
 * mirroring `PaymentProviderAdapter`'s own shape. One real implementation
 * exists this phase — `ManualShippingProvider` (an admin-driven,
 * no-external-network adapter) — ready for a live courier integration to
 * implement this same interface later with zero changes to the domain/
 * application layers above it.
 */
export interface ShippingProvider {
  createShipment(props: {
    fulfillmentId: string;
    carrier?: string | null;
    trackingNumber?: string | null;
    recipientAddress: Record<string, unknown>;
  }): Promise<ShippingProviderCreateResult>;

  getShipmentStatus(providerShipmentReference: string): Promise<ShippingProviderStatusResult>;

  cancelShipment(providerShipmentReference: string): Promise<ShippingProviderCancelResult>;
}
