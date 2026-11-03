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
  ORDER_STUCK_PENDING_GRACE_MS,
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
 * doc comment), two passes:
 *
 * 1. Every `CheckoutSession` Payment has already marked `CONVERTED` in
 *    the lookback window, re-run through the exact same
 *    `OrderConversionService.convertFromCheckout()` the synchronous path
 *    uses — idempotent by construction (an already-converted checkout is
 *    a cheap `findByCheckoutSessionId()` no-op), so an overlapping sweep
 *    or a retried job can never double-create an `Order`.
 * 2. Every `Order` still stuck `PENDING_PAYMENT` past
 *    `ORDER_STUCK_PENDING_GRACE_MS` — the case pass 1 structurally
 *    cannot catch, since a crash before `checkout.markConverted()` runs
 *    leaves that order's own checkout short of `CONVERTED` too. Resumed
 *    the same way: `convertFromCheckout(order.checkoutSessionId)`, which
 *    now resumes cleanly from exactly this state (see that method's own
 *    doc comment) instead of returning the stuck row as-is.
 * 3. Every payment intent `SUCCEEDED` in the lookback window that still has
 *    no order (CP-031, gap P0-4) — a payment verified after its checkout
 *    lapsed leaves the checkout EXPIRED/CANCELLED (never `CONVERTED`) and no
 *    order row, so neither pass above can see it; the payment itself is the
 *    one fact that cannot be missing.
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
      const order = await this.tryConvert(session.id);
      if (order) converted += 1;
    }

    const stuckOlderThan = new Date(Date.now() - ORDER_STUCK_PENDING_GRACE_MS);
    const stuckOrders = await this.orders.listStuckPendingConversion(stuckOlderThan);
    let resumed = 0;
    for (const order of stuckOrders) {
      const result = await this.tryConvert(order.checkoutSessionId);
      if (result) resumed += 1;
    }

    // Pass 3 (CP-031, gap P0-4) — a verified payment whose checkout had lapsed
    // (EXPIRED/CANCELLED, so never CONVERTED) and which never got an order:
    // found through the payment itself. Anything pass 1/2 already handled this
    // run is skipped; `convertFromCheckout` is idempotent either way.
    const handled = new Set<string>([
      ...convertedSessions.map((session) => session.id),
      ...stuckOrders.map((order) => order.checkoutSessionId),
    ]);
    const paidWithoutOrder = await this.orders.listPaidCheckoutIdsWithoutOrder(since);
    let recovered = 0;
    for (const checkoutSessionId of paidWithoutOrder) {
      if (handled.has(checkoutSessionId)) continue;
      const result = await this.tryConvert(checkoutSessionId);
      if (result) recovered += 1;
    }

    const scanned = convertedSessions.length + stuckOrders.length + paidWithoutOrder.length;
    this.logger.log(
      `order_conversion_sweep scanned=${scanned} converted=${converted} resumed=${resumed} recovered=${recovered}`,
    );
    return { scanned, converted: converted + resumed + recovered };
  }

  private async tryConvert(checkoutSessionId: string) {
    return this.conversion.convertFromCheckout(checkoutSessionId).catch((error: unknown) => {
      this.logger.warn(
        `order_conversion_sweep_failed checkoutSessionId=${checkoutSessionId} error=${String(error)}`,
      );
      return null;
    });
  }
}
