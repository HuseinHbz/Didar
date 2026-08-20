import { randomUUID } from 'node:crypto';

import { Prisma, prisma, type PrismaClient } from '@iecp/database';
import type { FulfillmentStatus, ShipmentStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { Fulfillment } from '../../domain/entities/fulfillment.entity';
import type { ShipmentEvent } from '../../domain/entities/shipment-event.entity';
import type { Shipment } from '../../domain/entities/shipment.entity';
import type {
  FulfillmentRepositoryPort,
  FulfillmentWithDetail,
  StatusUpdateResult,
} from '../../domain/ports/fulfillment.repository.port';
import { FulfillmentQuantityValidator } from '../../domain/services/fulfillment-quantity-validator';
import { FulfillmentStateMachine } from '../../domain/services/fulfillment-state-machine';
import { ShipmentStateMachine } from '../../domain/services/shipment-state-machine';
import {
  fulfillmentItemToDomain,
  fulfillmentToDomain,
  shipmentEventToDomain,
  shipmentToDomain,
} from '../order.mapper';

function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.['target'] as string[] | undefined)?.includes(column) === true
  );
}

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

interface LockedOrderItemRow {
  id: string;
  quantity: number;
}

/** Row-locks `commerce.order_items` (`SELECT ... FOR UPDATE`, the same
 * technique `mutateInventoryItem` established) and re-sums already
 * fulfilled quantity across every non-`CANCELLED` `Fulfillment` for that
 * item — both inside the caller's own transaction, so two truly
 * concurrent fulfillment requests targeting the same `OrderItem` can
 * never both pass `FulfillmentQuantityValidator` (ADR-009 decision 8). */
async function lockAndSumFulfilled(
  tx: TxClient,
  orderItemId: string,
): Promise<{ orderedQuantity: number; alreadyFulfilledQuantity: number }> {
  const rows = await tx.$queryRaw<LockedOrderItemRow[]>(
    Prisma.sql`SELECT id, quantity FROM commerce.order_items WHERE id = ${orderItemId}::uuid FOR UPDATE`,
  );
  const row = rows[0];
  if (!row) throw new Error(`OrderItem ${orderItemId} not found`);

  const sumRows = await tx.$queryRaw<{ total: bigint | null }[]>(
    Prisma.sql`SELECT COALESCE(SUM(fi.quantity), 0)::bigint AS total
      FROM commerce.fulfillment_items fi
      JOIN commerce.fulfillments f ON f.id = fi.fulfillment_id
      WHERE fi.order_item_id = ${orderItemId}::uuid AND f.status != 'CANCELLED'`,
  );
  const alreadyFulfilledQuantity = Number(sumRows[0]?.total ?? 0n);
  return { orderedQuantity: row.quantity, alreadyFulfilledQuantity };
}

@Injectable()
export class PrismaFulfillmentRepository implements FulfillmentRepositoryPort {
  async findById(id: string): Promise<FulfillmentWithDetail | null> {
    const row = await prisma.fulfillment.findUnique({
      where: { id },
      include: { items: true, shipment: { include: { events: true } } },
    });
    if (!row) return null;
    return {
      fulfillment: fulfillmentToDomain(row),
      items: row.items.map(fulfillmentItemToDomain),
      shipment: row.shipment ? shipmentToDomain(row.shipment) : null,
      shipmentEvents: row.shipment ? row.shipment.events.map(shipmentEventToDomain) : [],
    };
  }

  async listByOrderId(orderId: string): Promise<FulfillmentWithDetail[]> {
    const rows = await prisma.fulfillment.findMany({
      where: { orderId },
      include: { items: true, shipment: { include: { events: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      fulfillment: fulfillmentToDomain(row),
      items: row.items.map(fulfillmentItemToDomain),
      shipment: row.shipment ? shipmentToDomain(row.shipment) : null,
      shipmentEvents: row.shipment ? row.shipment.events.map(shipmentEventToDomain) : [],
    }));
  }

  async findShipmentById(id: string): Promise<Shipment | null> {
    const row = await prisma.shipment.findUnique({ where: { id } });
    return row ? shipmentToDomain(row) : null;
  }

  async sumFulfilledQuantity(orderItemId: string): Promise<number> {
    const rows = await prisma.$queryRaw<{ total: bigint | null }[]>(
      Prisma.sql`SELECT COALESCE(SUM(fi.quantity), 0)::bigint AS total
        FROM commerce.fulfillment_items fi
        JOIN commerce.fulfillments f ON f.id = fi.fulfillment_id
        WHERE fi.order_item_id = ${orderItemId}::uuid AND f.status != 'CANCELLED'`,
    );
    return Number(rows[0]?.total ?? 0n);
  }

  async create(props: {
    orderId: string;
    warehouseId?: string | null;
    items: readonly { orderItemId: string; quantity: number }[];
    idempotencyKey?: string | null;
  }): Promise<Fulfillment> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        for (const item of props.items) {
          const { orderedQuantity, alreadyFulfilledQuantity } = await lockAndSumFulfilled(
            tx,
            item.orderItemId,
          );
          FulfillmentQuantityValidator.assertFulfillable(
            item.orderItemId,
            orderedQuantity,
            alreadyFulfilledQuantity,
            item.quantity,
          );
        }

        return tx.fulfillment.create({
          data: {
            id: randomUUID(),
            orderId: props.orderId,
            warehouseId: props.warehouseId ?? null,
            idempotencyKey: props.idempotencyKey ?? null,
            items: {
              create: props.items.map((item) => ({
                id: randomUUID(),
                orderItemId: item.orderItemId,
                quantity: item.quantity,
              })),
            },
          },
        });
      });
      return fulfillmentToDomain(row);
    } catch (error) {
      if (props.idempotencyKey && isUniqueViolationOn(error, 'idempotency_key')) {
        const existing = await prisma.fulfillment.findUnique({
          where: { idempotencyKey: props.idempotencyKey },
        });
        if (existing) return fulfillmentToDomain(existing);
      }
      throw error;
    }
  }

  /** ADR-011 decision 1 — row-locks the fulfillment, re-checks
   * `FulfillmentStateMachine` against the *locked* status before writing.
   * See the port's own doc comment for the full contract. */
  async updateStatus(
    id: string,
    status: FulfillmentStatus,
    extra?: { packedAt?: Date; shippedAt?: Date; deliveredAt?: Date; cancelledAt?: Date },
  ): Promise<StatusUpdateResult<Fulfillment>> {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: FulfillmentStatus }[]>(
        Prisma.sql`SELECT status FROM commerce.fulfillments WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const currentStatus = locked[0]?.status;
      if (currentStatus === undefined) throw new Error(`Fulfillment ${id} not found`);

      if (FulfillmentStateMachine.isNoOp(currentStatus, status)) {
        const unchanged = await tx.fulfillment.findUniqueOrThrow({ where: { id } });
        return { row: unchanged, transitioned: false };
      }
      FulfillmentStateMachine.assertTransition(currentStatus, status);

      const updated = await tx.fulfillment.update({
        where: { id },
        data: {
          status,
          packedAt: extra?.packedAt,
          shippedAt: extra?.shippedAt,
          deliveredAt: extra?.deliveredAt,
          cancelledAt: extra?.cancelledAt,
        },
      });
      return { row: updated, transitioned: true };
    });
    return { entity: fulfillmentToDomain(result.row), transitioned: result.transitioned };
  }

  /** Idempotent on `fulfillmentId` (`@unique`) — same P2002-catch-and-reread
   * pattern every other creation path in this repo uses. */
  async createShipment(
    fulfillmentId: string,
    props: { carrier?: string | null; trackingNumber?: string | null },
  ): Promise<Shipment> {
    try {
      const row = await prisma.shipment.create({
        data: {
          id: randomUUID(),
          fulfillmentId,
          carrier: props.carrier ?? null,
          trackingNumber: props.trackingNumber ?? null,
        },
      });
      return shipmentToDomain(row);
    } catch (error) {
      if (isUniqueViolationOn(error, 'fulfillment_id')) {
        const existing = await prisma.shipment.findUnique({ where: { fulfillmentId } });
        if (existing) return shipmentToDomain(existing);
      }
      throw error;
    }
  }

  async findShipmentByTrackingNumber(trackingNumber: string): Promise<Shipment | null> {
    const row = await prisma.shipment.findUnique({ where: { trackingNumber } });
    return row ? shipmentToDomain(row) : null;
  }

  /** ADR-011 decision 1 — same row-lock + re-check technique as
   * `updateStatus()` above, applied to `commerce.shipments`. */
  async updateShipmentStatus(
    shipmentId: string,
    status: ShipmentStatus,
    extra?: { shippedAt?: Date; deliveredAt?: Date },
  ): Promise<StatusUpdateResult<Shipment>> {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: ShipmentStatus }[]>(
        Prisma.sql`SELECT status FROM commerce.shipments WHERE id = ${shipmentId}::uuid FOR UPDATE`,
      );
      const currentStatus = locked[0]?.status;
      if (currentStatus === undefined) throw new Error(`Shipment ${shipmentId} not found`);

      if (ShipmentStateMachine.isNoOp(currentStatus, status)) {
        const unchanged = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
        return { row: unchanged, transitioned: false };
      }
      ShipmentStateMachine.assertTransition(currentStatus, status);

      const updated = await tx.shipment.update({
        where: { id: shipmentId },
        data: { status, shippedAt: extra?.shippedAt, deliveredAt: extra?.deliveredAt },
      });
      return { row: updated, transitioned: true };
    });
    return { entity: shipmentToDomain(result.row), transitioned: result.transitioned };
  }

  async addShipmentEvent(
    shipmentId: string,
    props: {
      status: ShipmentStatus;
      location?: string | null;
      details?: Record<string, unknown> | null;
      source?: string;
    },
  ): Promise<ShipmentEvent> {
    const row = await prisma.shipmentEvent.create({
      data: {
        id: randomUUID(),
        shipmentId,
        status: props.status,
        location: props.location ?? null,
        details: (props.details ?? undefined) as Prisma.InputJsonValue | undefined,
        source: props.source ?? 'MANUAL_ADMIN',
      },
    });
    return shipmentEventToDomain(row);
  }
}
