import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { CartService } from '../../application/cart.service';
import { CART_REPOSITORY, type CartRepositoryPort } from '../../domain/ports/cart.repository.port';

import { CART_ABANDONMENT_QUEUE, CART_SWEEP_INTERVAL_MS, DEFAULT_JOB_OPTIONS } from './queue-names';

const SWEEP_JOB_NAME = 'sweep-cart-abandonment';
const SWEEP_SCHEDULER_ID = 'cart-abandonment-sweep';

/** Producer — same self-registering repeatable-job shape as
 * `CheckoutExpirationQueueService` (see that file's own doc comment for
 * why a recurring sweep via `upsertJobScheduler`, not a per-cart delayed
 * job, is the right shape here too: `CartService.touch()` keeps pushing
 * `expiresAt` forward on every mutation, so only a sweep that re-reads
 * current state can tell whether a cart is *actually* still idle). */
@Injectable()
export class CartAbandonmentQueueService implements OnModuleInit {
  constructor(@InjectQueue(CART_ABANDONMENT_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: CART_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/** Consumer — reads every `ACTIVE` cart whose `expiresAt` has already
 * passed and marks each `ABANDONED` via `CartService.abandon()`
 * (idempotent, no reservations to release — carts never hold their own).
 */
@Processor(CART_ABANDONMENT_QUEUE)
export class CartAbandonmentProcessor extends WorkerHost {
  private readonly logger = new Logger(CartAbandonmentProcessor.name);

  constructor(
    @Inject(CART_REPOSITORY) private readonly carts: CartRepositoryPort,
    private readonly cart: CartService,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ abandonedCount: number }> {
    const due = await this.carts.listExpirable(new Date());
    for (const cart of due) {
      await this.cart.abandon(cart.id);
      this.logger.log(`cart_abandoned cartId=${cart.id}`);
    }
    return { abandonedCount: due.length };
  }
}
