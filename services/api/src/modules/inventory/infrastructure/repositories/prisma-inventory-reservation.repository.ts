import { randomUUID } from 'node:crypto';

import { prisma, type InventoryReservation as PrismaInventoryReservation } from '@iecp/database';
import type { ProductSkuId, WarehouseId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { InventoryReservation } from '../../domain/entities/inventory-reservation.entity';
import type { InventoryReservationRepositoryPort } from '../../domain/ports/inventory-reservation.repository.port';
import { InsufficientStockError } from '../../domain/services/available-quantity-calculator';
import { ReservationRules } from '../../domain/services/reservation-rules';
import { mutateInventoryItem } from '../inventory-item-mutator';

@Injectable()
export class PrismaInventoryReservationRepository implements InventoryReservationRepositoryPort {
  async findById(id: string): Promise<InventoryReservation | null> {
    const row = await prisma.inventoryReservation.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<InventoryReservation | null> {
    const row = await prisma.inventoryReservation.findUnique({ where: { idempotencyKey: key } });
    return row ? toDomain(row) : null;
  }

  async listExpirable(now: Date): Promise<InventoryReservation[]> {
    const rows = await prisma.inventoryReservation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
    });
    return rows.map(toDomain);
  }

  async listBySource(sourceType: string, sourceId: string): Promise<InventoryReservation[]> {
    const rows = await prisma.inventoryReservation.findMany({ where: { sourceType, sourceId } });
    return rows.map(toDomain);
  }

  async reserve(props: {
    productSkuId: ProductSkuId;
    warehouseId: WarehouseId;
    quantity: number;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    expiresAt?: Date | null;
    actorUserId?: string | null;
    correlationId: string;
  }): Promise<InventoryReservation> {
    // Idempotency: a retried call with the same key returns the original
    // reservation instead of double-reserving (ADR-006 decision 5).
    const existing = await prisma.inventoryReservation.findUnique({
      where: { idempotencyKey: props.idempotencyKey },
    });
    if (existing) return toDomain(existing);

    return prisma.$transaction(async (tx) => {
      // Pick the warehouse's location with the most available stock for
      // this SKU — the caller (application layer / allocation engine)
      // decides the warehouse; which physical location within it fulfills
      // the reservation is an infrastructure-layer picking detail.
      const candidates = await tx.inventoryItem.findMany({
        where: { productSkuId: props.productSkuId, warehouseId: props.warehouseId },
        orderBy: { availableQuantity: 'desc' },
      });
      const target = candidates[0];
      if (!target) {
        throw new InsufficientStockError('available_quantity', props.quantity, 0);
      }

      ReservationRules.assertCanReserve(target, props.quantity);

      const { item } = await mutateInventoryItem(
        tx,
        target.id,
        { reserved: props.quantity },
        'RESERVATION',
        {
          quantity: props.quantity,
          referenceType: props.sourceType,
          referenceId: props.sourceId,
          actorUserId: props.actorUserId,
          correlationId: props.correlationId,
        },
      );

      const reservation = await tx.inventoryReservation.create({
        data: {
          id: randomUUID(),
          productSkuId: item.productSkuId,
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          inventoryItemId: item.id,
          quantity: props.quantity,
          status: 'ACTIVE',
          sourceType: props.sourceType,
          sourceId: props.sourceId,
          idempotencyKey: props.idempotencyKey,
          expiresAt: props.expiresAt ?? null,
        },
      });
      return toDomain(reservation);
    });
  }

  async release(
    id: string,
    props: { actorUserId?: string | null; correlationId: string; reason?: string | null },
  ): Promise<InventoryReservation> {
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservation.findUniqueOrThrow({ where: { id } });
      if (reservation.status !== 'ACTIVE') {
        throw new Error(`Reservation ${id} is not ACTIVE (status: ${reservation.status})`);
      }

      const item = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: reservation.inventoryItemId },
      });
      ReservationRules.assertCanRelease(item, reservation.quantity);

      await mutateInventoryItem(
        tx,
        item.id,
        { reserved: -reservation.quantity },
        'RESERVATION_RELEASE',
        {
          quantity: reservation.quantity,
          referenceType: reservation.sourceType,
          referenceId: reservation.sourceId,
          reason: props.reason,
          actorUserId: props.actorUserId,
          correlationId: props.correlationId,
        },
      );

      const updated = await tx.inventoryReservation.update({
        where: { id },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      return toDomain(updated);
    });
  }

  async convert(
    id: string,
    props: {
      actorUserId?: string | null;
      correlationId: string;
      referenceType?: string | null;
      referenceId?: string | null;
    },
  ): Promise<InventoryReservation> {
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservation.findUniqueOrThrow({ where: { id } });
      if (reservation.status !== 'ACTIVE') {
        throw new Error(`Reservation ${id} is not ACTIVE (status: ${reservation.status})`);
      }

      const item = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: reservation.inventoryItemId },
      });
      ReservationRules.assertCanConvert(item, reservation.quantity);

      await mutateInventoryItem(
        tx,
        item.id,
        { reserved: -reservation.quantity, onHand: -reservation.quantity },
        'SALE',
        {
          quantity: reservation.quantity,
          referenceType: props.referenceType ?? reservation.sourceType,
          referenceId: props.referenceId ?? reservation.sourceId,
          actorUserId: props.actorUserId,
          correlationId: props.correlationId,
        },
      );

      const updated = await tx.inventoryReservation.update({
        where: { id },
        data: { status: 'CONVERTED' },
      });
      return toDomain(updated);
    });
  }

  async expire(id: string, props: { correlationId: string }): Promise<InventoryReservation> {
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservation.findUniqueOrThrow({ where: { id } });
      if (reservation.status !== 'ACTIVE') return toDomain(reservation);

      const item = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: reservation.inventoryItemId },
      });
      // An already-inconsistent reservation (more reserved recorded on the
      // item than this reservation's own quantity — should never happen,
      // but expiry runs unattended via a queue job, so it fails loud
      // rather than silently releasing the wrong amount) still gets
      // validated the same way a manual release would be.
      ReservationRules.assertCanRelease(item, reservation.quantity);

      await mutateInventoryItem(
        tx,
        item.id,
        { reserved: -reservation.quantity },
        'RESERVATION_RELEASE',
        {
          quantity: reservation.quantity,
          referenceType: reservation.sourceType,
          referenceId: reservation.sourceId,
          reason: 'Reservation expired',
          correlationId: props.correlationId,
        },
      );

      const updated = await tx.inventoryReservation.update({
        where: { id },
        data: { status: 'EXPIRED', releasedAt: new Date() },
      });
      return toDomain(updated);
    });
  }
}

function toDomain(row: PrismaInventoryReservation): InventoryReservation {
  return InventoryReservation.create({
    id: row.id,
    productSkuId: row.productSkuId,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    inventoryItemId: row.inventoryItemId,
    quantity: row.quantity,
    status: row.status,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
