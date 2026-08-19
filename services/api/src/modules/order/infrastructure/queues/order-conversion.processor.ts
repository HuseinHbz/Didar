import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { CheckoutService } from '../../../cart-checkout/application/checkout.service';
import { OrderConversionService } from '../../application/order-conversion.service';
import {
  ORDER_REPOSITORY,
  type OrderRepositoryPort,
} from '../../domain/ports/order.repository.port';

import {
  DEFAULT_JOB_OPTIONS,
  ORDER_CONVERSION_LOOKBACK_MS,
  ORDER_CONVERSION_QUEUE,
  ORDER_CONVERSION_SWEEP_INTERVAL_MS,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-order-conversion';
const SWEEP_SCHEDULER_ID = 'order-conversion-sweep';

@Injectable()
export class OrderConversionQueueService implements OnModuleInit {
  constructor(@InjectQueue(ORDER_CONVERSION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: ORDER_CONVERSION_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * The `order_conversion` reliability backstop (`queue-names.ts`'s own
 * doc comment): every `CheckoutSession` Payment has already marked
 * `CONVERTED` in the lookback window, re-run through the exact same
 * `OrderConversionService.convertFromCheckout()` the synchronous path
 * uses — idempotent by construction (an already-converted checkout is a
 * cheap `findByCheckoutSessionId()` no-op), so an overlapping sweep or a
 * retried job can never double-create an `Order`.
 */
@Processor(ORDER_CONVERSION_QUEUE)
export class OrderConversionProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderConversionProcessor.name);

  constructor(
    private readonly checkout: CheckoutService,
    private readonly conversion: OrderConversionService,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepositoryPort,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ scanned: number; converted: number }> {
    const since = new Date(Date.now() - ORDER_CONVERSION_LOOKBACK_MS);
    const convertedSessions = await this.checkout.listConvertedSince(since);

    let converted = 0;
    for (const session of convertedSessions) {
      const existing = await this.orders.findByCheckoutSessionId(session.id);
      if (existing) continue;
      const order = await this.conversion.convertFromCheckout(session.id).catch((error: unknown) => {
        this.logger.warn(
          `order_conversion_sweep_failed checkoutSessionId=${session.id} error=${String(error)}`,
        );
        return null;
      });
      if (order) converted += 1;
    }

    this.logger.log(
      `order_conversion_sweep scanned=${convertedSessions.length} converted=${converted}`,
    );
    return { scanned: convertedSessions.length, converted };
  }
}
