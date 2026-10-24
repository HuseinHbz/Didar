import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import type { OrderExceptionResolution, OrderExceptionType } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { OrderException } from '../../domain/entities/order-exception.entity';
import type {
  OrderExceptionListFilter,
  OrderExceptionRepositoryPort,
} from '../../domain/ports/order-exception.repository.port';
import { orderExceptionToDomain } from '../order.mapper';

function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.['target'] as string[] | undefined)?.includes(column) === true
  );
}

@Injectable()
export class PrismaOrderExceptionRepository implements OrderExceptionRepositoryPort {
  async findById(id: string): Promise<OrderException | null> {
    const row = await prisma.orderException.findUnique({ where: { id } });
    return row ? orderExceptionToDomain(row) : null;
  }

  async findByDedupeKey(dedupeKey: string): Promise<OrderException | null> {
    const row = await prisma.orderException.findUnique({ where: { dedupeKey } });
    return row ? orderExceptionToDomain(row) : null;
  }

  async listOpenByOrderId(orderId: string): Promise<OrderException[]> {
    const rows = await prisma.orderException.findMany({
      where: { orderId, status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
    });
    return rows.map(orderExceptionToDomain);
  }

  async list(
    filter: OrderExceptionListFilter,
  ): Promise<{ items: OrderException[]; nextCursor: string | null }> {
    const rows = await prisma.orderException.findMany({
      where: { orderId: filter.orderId, status: filter.status },
      // Oldest first: the work queue is worked from the front, and a stable
      // (openedAt, id) order keeps cursor pagination deterministic.
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    return {
      items: page.map(orderExceptionToDomain),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * `dedupeKey` is `@unique`: of N racing callers exactly one `INSERT` wins
   * and the rest re-read the winner's row — same P2002-catch-and-reread
   * pattern as every idempotent write in this codebase (cart, checkout,
   * payment intent, order, invoice…). Proven under 12 concurrent conversions
   * in `payment-order-consistency.e2e-spec.ts`.
   */
  async openOrGet(props: {
    orderId: string;
    type: OrderExceptionType;
    productSkuId: string | null;
    requestedQuantity: number | null;
    dedupeKey: string;
    detail: Record<string, unknown> | null;
  }): Promise<{ exception: OrderException; wasNew: boolean }> {
    const existing = await prisma.orderException.findUnique({
      where: { dedupeKey: props.dedupeKey },
    });
    if (existing) return { exception: orderExceptionToDomain(existing), wasNew: false };

    try {
      const row = await prisma.orderException.create({
        data: {
          id: randomUUID(),
          orderId: props.orderId,
          type: props.type,
          productSkuId: props.productSkuId,
          requestedQuantity: props.requestedQuantity,
          dedupeKey: props.dedupeKey,
          detail: (props.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      return { exception: orderExceptionToDomain(row), wasNew: true };
    } catch (error) {
      if (isUniqueViolationOn(error, 'dedupe_key')) {
        const winner = await prisma.orderException.findUnique({
          where: { dedupeKey: props.dedupeKey },
        });
        if (winner) return { exception: orderExceptionToDomain(winner), wasNew: false };
      }
      throw error;
    }
  }

  async resolve(
    id: string,
    resolution: OrderExceptionResolution,
    resolvedBy: string | null,
  ): Promise<{ exception: OrderException; transitioned: boolean }> {
    const { count } = await prisma.orderException.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'RESOLVED', resolution, resolvedAt: new Date(), resolvedBy },
    });
    const row = await prisma.orderException.findUniqueOrThrow({ where: { id } });
    return { exception: orderExceptionToDomain(row), transitioned: count === 1 };
  }
}
