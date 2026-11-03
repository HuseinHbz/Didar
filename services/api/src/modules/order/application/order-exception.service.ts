import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { OrderException } from '../domain/entities/order-exception.entity';
import {
  ORDER_EXCEPTION_REPOSITORY,
  type OrderExceptionListFilter,
  type OrderExceptionRepositoryPort,
} from '../domain/ports/order-exception.repository.port';
import { ORDER_REPOSITORY, type OrderRepositoryPort } from '../domain/ports/order.repository.port';
import {
  OrderExceptionPolicy,
  StockStillShortError,
} from '../domain/services/order-exception-policy';

import { OrderAllocationService } from './order-allocation.service';

/**
 * CP-031 (gap P0-5) — the lifecycle of `OrderException`: open when a paid
 * order's stock cannot be allocated, block `approve`, close by allocating
 * (retry) or by cancelling the order. Every transition is race-safe at the
 * repository (`openOrGet` / `resolve`) and audited exactly once — only the
 * caller that actually performed the transition writes the audit row.
 */
@Injectable()
export class OrderExceptionService {
  private readonly logger = new Logger(OrderExceptionService.name);

  constructor(
    @Inject(ORDER_EXCEPTION_REPOSITORY) private readonly exceptions: OrderExceptionRepositoryPort,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
    private readonly allocation: OrderAllocationService,
  ) {}

  async get(id: string): Promise<OrderException> {
    const exception = await this.exceptions.findById(id);
    if (!exception) throw new NotFoundException('Order exception not found');
    return exception;
  }

  list(filter: OrderExceptionListFilter) {
    return this.exceptions.list(filter);
  }

  /**
   * Records that `requestedQuantity` units of `productSkuId` could not be
   * allocated to the order. Idempotent per (order, SKU): racing conversions,
   * sweeps and retries all land on the one row, and only the call that
   * created it audits and logs.
   */
  async openStockShortfall(input: {
    orderId: string;
    productSkuId: string;
    requestedQuantity: number;
    reason: string;
    checkoutReservationId: string | null;
  }): Promise<OrderException> {
    const { exception, wasNew } = await this.exceptions.openOrGet({
      orderId: input.orderId,
      type: 'STOCK_SHORTFALL',
      productSkuId: input.productSkuId,
      requestedQuantity: input.requestedQuantity,
      dedupeKey: OrderExceptionPolicy.stockShortfallKey(input.orderId, input.productSkuId),
      detail: { reason: input.reason, checkoutReservationId: input.checkoutReservationId },
    });
    if (wasNew) {
      this.logger.warn(
        `order_stock_shortfall orderId=${input.orderId} productSkuId=${input.productSkuId} ` +
          `requestedQuantity=${input.requestedQuantity} reason=${input.reason}`,
      );
      await this.auditLog.record({
        actorId: null,
        action: 'ORDER_EXCEPTION_OPENED',
        entityType: 'OrderException',
        entityId: exception.id,
        newValue: {
          orderId: input.orderId,
          type: exception.type,
          productSkuId: input.productSkuId,
          requestedQuantity: input.requestedQuantity,
          reason: input.reason,
        },
      });
    }
    return exception;
  }

  /** The stock turned out to be there after all (a resumed conversion): close
   * a previously opened shortfall for this line, if any. */
  async markAllocated(orderId: string, productSkuId: string): Promise<void> {
    const existing = await this.exceptions.findByDedupeKey(
      OrderExceptionPolicy.stockShortfallKey(orderId, productSkuId),
    );
    if (existing?.isOpen) await this.close(existing.id, 'ALLOCATED', null);
  }

  /** `OrderService.approve()` calls this first: an order with an open
   * exception does not move toward fulfillment (HTTP 409). */
  async assertApprovable(orderId: string): Promise<void> {
    OrderExceptionPolicy.assertApprovable(
      orderId,
      await this.exceptions.listOpenByOrderId(orderId),
    );
  }

  /** The order was cancelled: whatever was blocking it is moot. Closes every
   * open exception as `ORDER_CANCELLED`. */
  async resolveForCancelledOrder(orderId: string, actorUserId: string | null): Promise<void> {
    for (const exception of await this.exceptions.listOpenByOrderId(orderId)) {
      await this.close(exception.id, 'ORDER_CANCELLED', actorUserId);
    }
  }

  /**
   * `POST /admin/order-exceptions/:id/retry-allocation` — tries again to take
   * the line's stock out of the warehouse (the operator has restocked, or a
   * transfer landed). On success the exception is `RESOLVED / ALLOCATED`; if
   * the stock is still not there it raises `StockStillShortError` (409) and
   * changes nothing. Retrying a resolved exception is a harmless no-op.
   */
  async retryAllocation(id: string, actorUserId: string): Promise<OrderException> {
    const exception = await this.get(id);
    if (!exception.isOpen) return exception;

    const order = await this.orders.findById(exception.orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.order.status === 'CANCELLED') {
      return this.close(exception.id, 'ORDER_CANCELLED', actorUserId);
    }
    if (!exception.productSkuId || exception.requestedQuantity === null) {
      throw new StockStillShortError(
        exception.id,
        'the exception carries no SKU/quantity to retry',
      );
    }

    const checkoutReservationId =
      typeof exception.detail?.['checkoutReservationId'] === 'string'
        ? exception.detail['checkoutReservationId']
        : null;
    const outcome = await this.allocation.allocateLine({
      orderId: exception.orderId,
      productSkuId: exception.productSkuId,
      quantity: exception.requestedQuantity,
      checkoutReservationId,
    });
    if (outcome.kind === 'SHORT') throw new StockStillShortError(exception.id, outcome.reason);

    return this.close(exception.id, 'ALLOCATED', actorUserId);
  }

  private async close(
    id: string,
    resolution: 'ALLOCATED' | 'ORDER_CANCELLED',
    resolvedBy: string | null,
  ): Promise<OrderException> {
    const { exception, transitioned } = await this.exceptions.resolve(id, resolution, resolvedBy);
    if (transitioned) {
      await this.auditLog.record({
        actorId: resolvedBy,
        action: 'ORDER_EXCEPTION_RESOLVED',
        entityType: 'OrderException',
        entityId: exception.id,
        oldValue: { status: 'OPEN' },
        newValue: { status: 'RESOLVED', resolution, orderId: exception.orderId },
      });
    }
    return exception;
  }
}
