import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../../config/env';
import { AUDIT_LOG_REPOSITORY } from '../../../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../../../identity/infrastructure/repositories/prisma-audit-log.repository';
import { LowStockService } from '../../application/low-stock.service';
import { ReservationService } from '../../application/reservation.service';
import { INVENTORY_EVENT_PUBLISHER } from '../../domain/ports/inventory-event-publisher.port';
import { INVENTORY_RESERVATION_REPOSITORY } from '../../domain/ports/inventory-reservation.repository.port';
import { INVENTORY_THRESHOLD_REPOSITORY } from '../../domain/ports/inventory-threshold.repository.port';
import { LOW_STOCK_CHECK_SCHEDULER } from '../../domain/ports/low-stock-check-scheduler.port';
import { RESERVATION_EXPIRATION_SCHEDULER } from '../../domain/ports/reservation-expiration-scheduler.port';
import { PrismaInventoryReservationRepository } from '../repositories/prisma-inventory-reservation.repository';
import { PrismaInventoryThresholdRepository } from '../repositories/prisma-inventory-threshold.repository';

import { InventoryEventProcessor, InventoryEventsQueueService } from './inventory-event.processor';
import {
  LowStockNotificationProcessor,
  LowStockQueueService,
} from './low-stock-notification.processor';
import {
  INVENTORY_EVENT_PROCESSING_QUEUE,
  LOW_STOCK_NOTIFICATION_QUEUE,
  RESERVATION_EXPIRATION_QUEUE,
} from './queue-names';
import {
  ReservationExpirationProcessor,
  ReservationExpirationQueueService,
} from './reservation-expiration.processor';

/**
 * Registers BullMQ in-process inside `services/api` — a deliberate
 * departure from `services/worker` (the project's usual home for BullMQ
 * consumers) for these three queues specifically, since their processors
 * need the exact same domain services (`ReservationService`,
 * `LowStockService`) and Prisma transactional context the HTTP
 * controllers already use. See ADR-006 decision 8 and this module's
 * README for the full rationale.
 *
 * `ReservationService`/`LowStockService` (and the repository bindings they
 * need) are re-declared as providers here rather than imported from
 * `InventoryModule` — NestJS's DI is hierarchical (a module sees its own
 * imports' *exports*, never a parent's providers), so a processor
 * registered in this module cannot resolve a service only provided by the
 * module that imports it. Re-binding fresh instances of these stateless
 * Prisma-backed classes is the same precedent `catalog.module.ts` already
 * set for `AUDIT_LOG_REPOSITORY` — cheap, and keeps this module's
 * dependency graph self-contained.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue(
      { name: RESERVATION_EXPIRATION_QUEUE },
      { name: LOW_STOCK_NOTIFICATION_QUEUE },
      { name: INVENTORY_EVENT_PROCESSING_QUEUE },
    ),
  ],
  providers: [
    ReservationService,
    LowStockService,
    { provide: INVENTORY_RESERVATION_REPOSITORY, useClass: PrismaInventoryReservationRepository },
    { provide: INVENTORY_THRESHOLD_REPOSITORY, useClass: PrismaInventoryThresholdRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    ReservationExpirationProcessor,
    ReservationExpirationQueueService,
    { provide: RESERVATION_EXPIRATION_SCHEDULER, useExisting: ReservationExpirationQueueService },
    LowStockNotificationProcessor,
    LowStockQueueService,
    { provide: LOW_STOCK_CHECK_SCHEDULER, useExisting: LowStockQueueService },
    InventoryEventProcessor,
    InventoryEventsQueueService,
    { provide: INVENTORY_EVENT_PUBLISHER, useExisting: InventoryEventsQueueService },
  ],
  exports: [
    ReservationExpirationQueueService,
    RESERVATION_EXPIRATION_SCHEDULER,
    LowStockQueueService,
    LOW_STOCK_CHECK_SCHEDULER,
    InventoryEventsQueueService,
    INVENTORY_EVENT_PUBLISHER,
  ],
})
export class InventoryQueueModule {}
