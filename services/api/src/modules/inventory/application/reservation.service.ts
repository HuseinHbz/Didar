import { randomUUID } from 'node:crypto';

import type { ProductSkuId, UserId, WarehouseId } from '@iecp/types';
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import { InventoryReservation } from '../domain/entities/inventory-reservation.entity';
import {
  INVENTORY_EVENT_PUBLISHER,
  type InventoryEventPublisherPort,
} from '../domain/ports/inventory-event-publisher.port';
import {
  INVENTORY_RESERVATION_REPOSITORY,
  type InventoryReservationRepositoryPort,
} from '../domain/ports/inventory-reservation.repository.port';
import {
  LOW_STOCK_CHECK_SCHEDULER,
  type LowStockCheckSchedulerPort,
} from '../domain/ports/low-stock-check-scheduler.port';
import {
  RESERVATION_EXPIRATION_SCHEDULER,
  type ReservationExpirationSchedulerPort,
} from '../domain/ports/reservation-expiration-scheduler.port';

/**
 * The reservation engine (blueprint's inventory §24-§27, this phase's
 * `reservation_engine` requirement). Every write is idempotency-key-
 * protected and delegates the actual row-lock + validate + ledger-write
 * sequence to `PrismaInventoryReservationRepository` (ADR-006 decisions
 * 3-4) — this service's job is the surrounding orchestration: generating a
 * `correlationId` per call, defaulting an idempotency key when the caller
 * doesn't supply one, scheduling asynchronous expiration, publishing
 * `inventory_*` events, and auditing conversions (the point stock
 * actually leaves the warehouse).
 *
 * The scheduler/publisher ports are `@Optional()` — this service is also
 * instantiated inside `InventoryQueueModule` itself (so its own
 * `expire()` processor can reuse the same validated release path), where
 * re-scheduling an expiration or re-publishing an event would be
 * redundant, not just unavailable. Both calls are already no-ops when the
 * dependency isn't bound.
 */
@Injectable()
export class ReservationService {
  constructor(
    @Inject(INVENTORY_RESERVATION_REPOSITORY)
    private readonly reservations: InventoryReservationRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
    @Optional()
    @Inject(RESERVATION_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler?: ReservationExpirationSchedulerPort,
    @Optional()
    @Inject(INVENTORY_EVENT_PUBLISHER)
    private readonly events?: InventoryEventPublisherPort,
    @Optional()
    @Inject(LOW_STOCK_CHECK_SCHEDULER)
    private readonly lowStockScheduler?: LowStockCheckSchedulerPort,
  ) {}

  async get(id: string): Promise<InventoryReservation> {
    const reservation = await this.reservations.findById(id);
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  async reserve(input: {
    productSkuId: ProductSkuId;
    warehouseId: WarehouseId;
    quantity: number;
    sourceType: string;
    sourceId: string;
    idempotencyKey?: string;
    expiresAt?: Date | null;
    actorUserId?: UserId | null;
  }): Promise<InventoryReservation> {
    const correlationId = randomUUID();
    const reservation = await this.reservations.reserve({
      productSkuId: input.productSkuId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      expiresAt: input.expiresAt ?? null,
      actorUserId: input.actorUserId,
      correlationId,
    });
    if (reservation.expiresAt) {
      await this.expirationScheduler?.scheduleExpiration(reservation.id, reservation.expiresAt);
    }
    await this.events?.publish('inventory_reserved', correlationId, {
      reservationId: reservation.id,
      productSkuId: reservation.productSkuId,
      warehouseId: reservation.warehouseId,
      quantity: reservation.quantity,
    });
    await this.lowStockScheduler?.scheduleCheck(reservation.productSkuId, reservation.warehouseId);
    return reservation;
  }

  async release(
    id: string,
    actorUserId?: UserId | null,
    reason?: string | null,
  ): Promise<InventoryReservation> {
    await this.get(id);
    const correlationId = randomUUID();
    const reservation = await this.reservations.release(id, { actorUserId, reason, correlationId });
    await this.events?.publish('inventory_reservation_released', correlationId, {
      reservationId: reservation.id,
      productSkuId: reservation.productSkuId,
      warehouseId: reservation.warehouseId,
      quantity: reservation.quantity,
    });
    return reservation;
  }

  async convert(
    id: string,
    actorUserId?: UserId | null,
    reference?: { referenceType: string; referenceId: string },
  ): Promise<InventoryReservation> {
    const before = await this.get(id);
    const correlationId = randomUUID();
    const converted = await this.reservations.convert(id, {
      actorUserId,
      correlationId,
      referenceType: reference?.referenceType,
      referenceId: reference?.referenceId,
    });
    await this.auditLog.record({
      actorId: actorUserId ?? null,
      action: 'INVENTORY_RESERVATION_CONVERTED',
      entityType: 'InventoryReservation',
      entityId: id,
      oldValue: { status: before.status },
      newValue: { status: converted.status, quantity: converted.quantity, correlationId },
    });
    return converted;
  }

  /** Called by the `reservation_expiration` BullMQ processor — never a
   * direct admin/internal API action, but written here so the same
   * validated, row-locked release path is used either way. */
  async expire(id: string): Promise<InventoryReservation> {
    const correlationId = randomUUID();
    const reservation = await this.reservations.expire(id, { correlationId });
    await this.events?.publish('inventory_reservation_expired', correlationId, {
      reservationId: reservation.id,
      productSkuId: reservation.productSkuId,
      warehouseId: reservation.warehouseId,
      quantity: reservation.quantity,
    });
    return reservation;
  }

  listExpirable(now: Date = new Date()): Promise<InventoryReservation[]> {
    return this.reservations.listExpirable(now);
  }
}
