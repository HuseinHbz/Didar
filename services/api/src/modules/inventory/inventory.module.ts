import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AUDIT_LOG_REPOSITORY } from '../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../identity/infrastructure/repositories/prisma-audit-log.repository';

import { AdjustmentService } from './application/adjustment.service';
import { AllocationService } from './application/allocation.service';
import { LedgerService } from './application/ledger.service';
import { LocationsService } from './application/locations.service';
import { LowStockService } from './application/low-stock.service';
import { PurchaseOrderService } from './application/purchase-order.service';
import { ReservationService } from './application/reservation.service';
import { StockCountService } from './application/stock-count.service';
import { StockQueryService } from './application/stock-query.service';
import { SupplierService } from './application/supplier.service';
import { TransferService } from './application/transfer.service';
import { WarehousesService } from './application/warehouses.service';
import { ALLOCATION_RULES_REPOSITORY } from './domain/ports/allocation-rules.repository.port';
import { INVENTORY_ADJUSTMENT_REPOSITORY } from './domain/ports/inventory-adjustment.repository.port';
import { INVENTORY_ITEM_REPOSITORY } from './domain/ports/inventory-item.repository.port';
import { INVENTORY_LEDGER_REPOSITORY } from './domain/ports/inventory-ledger.repository.port';
import { INVENTORY_RESERVATION_REPOSITORY } from './domain/ports/inventory-reservation.repository.port';
import { INVENTORY_THRESHOLD_REPOSITORY } from './domain/ports/inventory-threshold.repository.port';
import { PURCHASE_ORDER_REPOSITORY } from './domain/ports/purchase-order.repository.port';
import { SKU_LOOKUP_PORT } from './domain/ports/sku-lookup.port';
import { STOCK_COUNT_REPOSITORY } from './domain/ports/stock-count.repository.port';
import { STOCK_TRANSFER_REPOSITORY } from './domain/ports/stock-transfer.repository.port';
import { SUPPLIER_REPOSITORY } from './domain/ports/supplier.repository.port';
import { WAREHOUSE_LOCATION_REPOSITORY } from './domain/ports/warehouse-location.repository.port';
import { WAREHOUSE_REPOSITORY } from './domain/ports/warehouse.repository.port';
import { InventoryQueueModule } from './infrastructure/queues/inventory-queue.module';
import { PrismaAllocationRulesRepository } from './infrastructure/repositories/prisma-allocation-rules.repository';
import { PrismaInventoryAdjustmentRepository } from './infrastructure/repositories/prisma-inventory-adjustment.repository';
import { PrismaInventoryItemRepository } from './infrastructure/repositories/prisma-inventory-item.repository';
import { PrismaInventoryLedgerRepository } from './infrastructure/repositories/prisma-inventory-ledger.repository';
import { PrismaInventoryReservationRepository } from './infrastructure/repositories/prisma-inventory-reservation.repository';
import { PrismaInventoryThresholdRepository } from './infrastructure/repositories/prisma-inventory-threshold.repository';
import { PrismaPurchaseOrderRepository } from './infrastructure/repositories/prisma-purchase-order.repository';
import { PrismaSkuLookupRepository } from './infrastructure/repositories/prisma-sku-lookup.repository';
import { PrismaStockCountRepository } from './infrastructure/repositories/prisma-stock-count.repository';
import { PrismaStockTransferRepository } from './infrastructure/repositories/prisma-stock-transfer.repository';
import { PrismaSupplierRepository } from './infrastructure/repositories/prisma-supplier.repository';
import { PrismaWarehouseLocationRepository } from './infrastructure/repositories/prisma-warehouse-location.repository';
import { PrismaWarehouseRepository } from './infrastructure/repositories/prisma-warehouse.repository';
import { AdjustmentController } from './presentation/controllers/adjustment.controller';
import { AvailabilityController } from './presentation/controllers/availability.controller';
import { CatalogAvailabilityPublicController } from './presentation/controllers/catalog-availability-public.controller';
import { LedgerController } from './presentation/controllers/ledger.controller';
import { PurchaseOrderController } from './presentation/controllers/purchase-order.controller';
import { ReservationController } from './presentation/controllers/reservation.controller';
import { StockCountController } from './presentation/controllers/stock-count.controller';
import { StockController } from './presentation/controllers/stock.controller';
import { SupplierController } from './presentation/controllers/supplier.controller';
import { TransferController } from './presentation/controllers/transfer.controller';
import { WarehouseController } from './presentation/controllers/warehouse.controller';
import { InventoryDomainExceptionFilter } from './presentation/filters/inventory-domain-exception.filter';

/**
 * Composition root for the inventory domain (Phase 006 — see this
 * module's README and docs/adr/ADR-006-inventory-architecture.md). Every
 * port token is bound to its Prisma implementation here, same convention
 * `catalog.module.ts` and `identity.module.ts` established.
 *
 * Imports `InventoryQueueModule` (registers BullMQ + the three queues —
 * ADR-006 decision 8) so its exported port tokens
 * (`RESERVATION_EXPIRATION_SCHEDULER`, `LOW_STOCK_CHECK_SCHEDULER`,
 * `INVENTORY_EVENT_PUBLISHER`) are visible to the `ReservationService`/
 * `TransferService`/`AdjustmentService` instances declared here — a
 * *separate* instance from the one `InventoryQueueModule` provides for its
 * own processors (see that module's own doc comment for why: NestJS DI is
 * hierarchical, a child module's providers aren't visible to its parent
 * except through explicit exports).
 *
 * `AUDIT_LOG_REPOSITORY` is re-bound here (not imported from
 * `IdentityModule`) — the same precedent `catalog.module.ts` set: the
 * underlying `PrismaAuditLogRepository` is a stateless wrapper over the
 * shared `prisma` singleton, cheap to instantiate per module.
 */
@Module({
  imports: [InventoryQueueModule],
  controllers: [
    WarehouseController,
    StockController,
    LedgerController,
    AdjustmentController,
    TransferController,
    StockCountController,
    ReservationController,
    AvailabilityController,
    CatalogAvailabilityPublicController,
    SupplierController,
    PurchaseOrderController,
  ],
  providers: [
    WarehousesService,
    LocationsService,
    StockQueryService,
    LedgerService,
    ReservationService,
    TransferService,
    AdjustmentService,
    StockCountService,
    LowStockService,
    AllocationService,
    SupplierService,
    PurchaseOrderService,
    { provide: WAREHOUSE_REPOSITORY, useClass: PrismaWarehouseRepository },
    { provide: WAREHOUSE_LOCATION_REPOSITORY, useClass: PrismaWarehouseLocationRepository },
    { provide: INVENTORY_ITEM_REPOSITORY, useClass: PrismaInventoryItemRepository },
    { provide: INVENTORY_THRESHOLD_REPOSITORY, useClass: PrismaInventoryThresholdRepository },
    { provide: INVENTORY_LEDGER_REPOSITORY, useClass: PrismaInventoryLedgerRepository },
    { provide: INVENTORY_RESERVATION_REPOSITORY, useClass: PrismaInventoryReservationRepository },
    { provide: STOCK_TRANSFER_REPOSITORY, useClass: PrismaStockTransferRepository },
    { provide: INVENTORY_ADJUSTMENT_REPOSITORY, useClass: PrismaInventoryAdjustmentRepository },
    { provide: STOCK_COUNT_REPOSITORY, useClass: PrismaStockCountRepository },
    { provide: SKU_LOOKUP_PORT, useClass: PrismaSkuLookupRepository },
    { provide: ALLOCATION_RULES_REPOSITORY, useClass: PrismaAllocationRulesRepository },
    { provide: SUPPLIER_REPOSITORY, useClass: PrismaSupplierRepository },
    { provide: PURCHASE_ORDER_REPOSITORY, useClass: PrismaPurchaseOrderRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    { provide: APP_FILTER, useClass: InventoryDomainExceptionFilter },
  ],
  // Phase 007 (ADR-007 decision 4) — `ReservationService`/`AllocationService`/
  // `StockQueryService` are exported so `CartCheckoutModule` can import this
  // module and inject them directly, reusing the real reservation engine
  // instead of reimplementing it. Additive, behavior-preserving: nothing
  // about how this module serves its own controllers changes.
  //
  // Phase 012 (ADR-012 decision 6) — `AdjustmentService` added, additively,
  // so `ReturnModule` can call `receiveReturnedStock()` directly instead of
  // re-binding `INVENTORY_ITEM_REPOSITORY` locally.
  exports: [ReservationService, AllocationService, StockQueryService, AdjustmentService],
})
export class InventoryModule {}
