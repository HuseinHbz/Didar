import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { InvoiceService } from '../../application/invoice.service';
import {
  ORDER_REPOSITORY,
  type OrderRepositoryPort,
} from '../../domain/ports/order.repository.port';

import {
  DEFAULT_JOB_OPTIONS,
  INVOICE_GENERATION_LOOKBACK_MS,
  INVOICE_GENERATION_QUEUE,
  INVOICE_GENERATION_SWEEP_INTERVAL_MS,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-invoice-generation';
const SWEEP_SCHEDULER_ID = 'invoice-generation-sweep';

@Injectable()
export class InvoiceGenerationQueueService implements OnModuleInit {
  constructor(@InjectQueue(INVOICE_GENERATION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: INVOICE_GENERATION_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * The `invoice_generation` reliability backstop (`queue-names.ts`'s own
 * doc comment): every real (past `PENDING_PAYMENT`) order in the lookback
 * window that doesn't yet have an `Invoice` — a crash between
 * `orders.create()` and `invoices.issueForOrder()` inside the same
 * `OrderConversionService` call is the only realistic way this happens.
 * `InvoiceService.issueForOrder()` is itself idempotent on `orderId`, so
 * this can never double-issue.
 */
@Processor(INVOICE_GENERATION_QUEUE)
export class InvoiceGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(InvoiceGenerationProcessor.name);

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepositoryPort,
    private readonly invoices: InvoiceService,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ scanned: number; issued: number }> {
    const since = new Date(Date.now() - INVOICE_GENERATION_LOOKBACK_MS);
    const orders = await this.orders.listRecentlyPaid(since);

    let issued = 0;
    for (const order of orders) {
      const existing = await this.invoices.getByOrderId(order.id);
      if (existing) continue;

      const detail = await this.orders.findById(order.id);
      if (!detail) continue;

      await this.invoices
        .issueForOrder({
          orderId: order.id,
          customerId: order.customerId,
          currency: order.currency,
          subtotal: order.subtotal,
          discountTotal: order.discountTotal,
          taxTotal: order.taxTotal,
          shippingTotal: order.shippingTotal,
          grandTotal: order.grandTotal,
          items: detail.items.map((item) => ({
            description: item.nameSnapshot,
            quantity: item.quantity,
            unitPrice: item.unitPriceSnapshot,
            lineTotal: item.lineTotal,
          })),
        })
        .then(() => {
          issued += 1;
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `invoice_generation_sweep_failed orderId=${order.id} error=${String(error)}`,
          );
        });
    }

    this.logger.log(`invoice_generation_sweep scanned=${orders.length} issued=${issued}`);
    return { scanned: orders.length, issued };
  }
}
