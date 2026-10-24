import { Injectable } from '@nestjs/common';

import { StockSaleService } from '../../inventory/application/stock-sale.service';

/** The result of getting one order line's stock out of the warehouse. */
export type OrderLineAllocation = { kind: 'ALLOCATED' } | { kind: 'SHORT'; reason: string };

/**
 * CP-031 (gap P0-5) — the one place an order's stock is taken out of the
 * warehouse. Used by order creation (`OrderConversionService`) and by an
 * operator's retry of a stock-shortfall exception (`OrderExceptionService`),
 * so the two can never disagree about what "this line has stock" means.
 *
 * Two steps, in order:
 *
 * 1. **Sell the checkout's own reservation**, if it still holds the units —
 *    the normal path: the customer paid inside the hold.
 * 2. **Otherwise re-acquire**: the hold was released (it lapsed, or an
 *    operator cancelled the checkout) while the payment was still in flight.
 *    Reserve afresh under `order__<orderId>__<sku>` — a deterministic key, so
 *    every racing sweep, retry and customer-return call converges on one
 *    reservation and one sale — and sell it. If the stock was meanwhile sold
 *    to someone else the result is `SHORT`, which the caller turns into an
 *    `OrderException` rather than letting a PAID order exist with nothing
 *    behind it.
 *
 * Sale is exactly-once and idempotent by construction (`StockSaleService`).
 */
@Injectable()
export class OrderAllocationService {
  constructor(private readonly sales: StockSaleService) {}

  async allocateLine(input: {
    orderId: string;
    productSkuId: string;
    quantity: number;
    /** The checkout's reservation for this line, when there is one. */
    checkoutReservationId: string | null;
  }): Promise<OrderLineAllocation> {
    const reference = { referenceType: 'ORDER', referenceId: input.orderId };

    if (input.checkoutReservationId) {
      const held = await this.sales.sellReserved(input.checkoutReservationId, reference);
      if (held.kind === 'SOLD') return { kind: 'ALLOCATED' };
      // The reservation exists and is ACTIVE but cannot be sold (the item's
      // quantities disagree with it): re-acquiring would hold the same stock
      // twice. Surface it instead.
      if (held.kind === 'SHORT') return { kind: 'SHORT', reason: held.reason };
      // NOT_HELD — released/expired: fall through and re-acquire.
    }

    const acquired = await this.sales.acquireAndSell({
      productSkuId: input.productSkuId,
      quantity: input.quantity,
      sourceType: 'ORDER',
      sourceId: input.orderId,
      idempotencyKey: `order__${input.orderId}__${input.productSkuId}`,
      reference,
    });
    return acquired.kind === 'SOLD'
      ? { kind: 'ALLOCATED' }
      : { kind: 'SHORT', reason: acquired.reason };
  }
}
