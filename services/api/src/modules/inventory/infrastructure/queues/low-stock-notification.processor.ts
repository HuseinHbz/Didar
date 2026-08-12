import { randomUUID } from 'node:crypto';

import { asWarehouseId } from '@iecp/types';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { LowStockService } from '../../application/low-stock.service';
import {
  INVENTORY_EVENT_PUBLISHER,
  type InventoryEventPublisherPort,
} from '../../domain/ports/inventory-event-publisher.port';
import type { LowStockCheckSchedulerPort } from '../../domain/ports/low-stock-check-scheduler.port';

import { DEFAULT_JOB_OPTIONS, LOW_STOCK_NOTIFICATION_QUEUE } from './queue-names';

export interface LowStockCheckJobData {
  productSkuId: string;
  warehouseId: string;
}

/** Producer — implements `LowStockCheckSchedulerPort`. Enqueued after any
 * mutation that can only ever *decrease* available quantity (reserve,
 * adjustment, transfer dispatch, count reconciliation) for the
 * SKU+warehouse it touched. Job id = `skuId__warehouseId` (BullMQ rejects
 * custom job ids containing ':'), so many mutations to the same
 * SKU/warehouse in a short window collapse into one pending check rather
 * than one job per mutation. */
@Injectable()
export class LowStockQueueService implements LowStockCheckSchedulerPort {
  constructor(
    @InjectQueue(LOW_STOCK_NOTIFICATION_QUEUE) private readonly queue: Queue<LowStockCheckJobData>,
  ) {}

  async scheduleCheck(productSkuId: string, warehouseId: string): Promise<void> {
    await this.queue.add(
      'check-low-stock',
      { productSkuId, warehouseId },
      { ...DEFAULT_JOB_OPTIONS, jobId: `${productSkuId}__${warehouseId}` },
    );
  }
}

/**
 * Consumer — re-evaluates the SKU+warehouse's low-stock status
 * (`LowStockService`, which reads thresholds from the database, never
 * hardcoded) and publishes `inventory_low_stock` when it's actually low.
 * No notification channel is wired this phase (see this module's README
 * "Deferred") — the event is observable (log line via the event
 * processor, metric) but doesn't fan out to SMS/email/push yet.
 */
@Processor(LOW_STOCK_NOTIFICATION_QUEUE)
export class LowStockNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(LowStockNotificationProcessor.name);

  constructor(
    private readonly lowStock: LowStockService,
    @Optional()
    @Inject(INVENTORY_EVENT_PUBLISHER)
    private readonly events?: InventoryEventPublisherPort,
  ) {
    super();
  }

  async process(job: Job<LowStockCheckJobData>): Promise<{ isLow: boolean }> {
    const rows = await this.lowStock.listLowStock(asWarehouseId(job.data.warehouseId));
    const match = rows.find((row) => row.threshold.productSkuId === job.data.productSkuId);
    if (match) {
      const correlationId = randomUUID();
      this.logger.warn(
        `inventory_low_stock productSkuId=${job.data.productSkuId} warehouseId=${job.data.warehouseId} ` +
          `available=${match.availableQuantity} floor=${match.threshold.reorderPoint + match.threshold.safetyStock}`,
      );
      await this.events?.publish('inventory_low_stock', correlationId, {
        productSkuId: job.data.productSkuId,
        warehouseId: job.data.warehouseId,
        availableQuantity: match.availableQuantity,
        effectiveFloor: match.threshold.reorderPoint + match.threshold.safetyStock,
      });
    }
    return { isLow: Boolean(match) };
  }
}
