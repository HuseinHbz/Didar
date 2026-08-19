import { randomUUID } from 'node:crypto';

import { prisma } from '@iecp/database';
import type {
  ShippingProviderCancelResult,
  ShippingProviderCreateResult,
  ShippingProviderStatusResult,
} from '@iecp/types';
import { Injectable } from '@nestjs/common';

import {
  UnknownShipmentReferenceError,
  type ShippingProvider,
} from '../../domain/ports/shipping-provider.port';

/**
 * ADR-009 decision 12 — the one real `ShippingProvider` implementation
 * this phase ships, and it's honest about what it is: no live courier API
 * exists anywhere in this codebase to integrate. An admin/support user
 * enters `carrier`/`trackingNumber` directly (already persisted on
 * `Shipment` by the time this adapter is called); `providerShipmentReference`
 * here is simply the `Shipment.id` itself — there is no external system's
 * own reference to track. `getShipmentStatus()` reads back whatever the
 * last admin-recorded `ShipmentEvent` says; it never polls anything.
 */
@Injectable()
export class ManualShippingProvider implements ShippingProvider {
  createShipment(props: {
    fulfillmentId: string;
    carrier?: string | null;
    trackingNumber?: string | null;
    recipientAddress: Record<string, unknown>;
  }): Promise<ShippingProviderCreateResult> {
    return Promise.resolve({
      providerShipmentReference: randomUUID(),
      trackingNumber: props.trackingNumber ?? null,
    });
  }

  async getShipmentStatus(
    providerShipmentReference: string,
  ): Promise<ShippingProviderStatusResult> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: providerShipmentReference },
      include: { events: { orderBy: { occurredAt: 'desc' }, take: 1 } },
    });
    if (!shipment) throw new UnknownShipmentReferenceError(providerShipmentReference);
    const latestEvent = shipment.events[0];
    return {
      status: shipment.status,
      location: latestEvent?.location ?? null,
      occurredAt: latestEvent?.occurredAt ?? shipment.updatedAt,
    };
  }

  cancelShipment(): Promise<ShippingProviderCancelResult> {
    // No external courier to notify — the caller (FulfillmentService)
    // is responsible for the actual status transition via
    // FulfillmentRepositoryPort.updateShipmentStatus(); this adapter has
    // nothing further to do.
    return Promise.resolve({ cancelled: true });
  }
}
