import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import type { OrderFulfillmentStatus, OrderPaymentStatus, OrderSource, OrderStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { Order } from '../../domain/entities/order.entity';
import type {
  OrderListFilter,
  OrderRepositoryPort,
  OrderWithDetail,
} from '../../domain/ports/order.repository.port';
import { orderItemToDomain, orderStatusHistoryToDomain, orderToDomain } from '../order.mapper';

function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.['target'] as string[] | undefined)?.includes(column) === true
  );
}

/** `ORD-YYYYMMDD-NNNNNN` — the date `nextval()` was drawn, then the raw
 * sequence value zero-padded to 6 digits (ADR-009 decision 6). */
function formatOrderNumber(seq: bigint, drawnAt: Date): string {
  const y = drawnAt.getUTCFullYear();
  const m = String(drawnAt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(drawnAt.getUTCDate()).padStart(2, '0');
  return `ORD-${y}${m}${d}-${seq.toString().padStart(6, '0')}`;
}

@Injectable()
export class PrismaOrderRepository implements OrderRepositoryPort {
  async findById(id: string): Promise<OrderWithDetail | null> {
    const row = await prisma.order.findUnique({
      where: { id },
      include: { items: true, statusHistory: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    return {
      order: orderToDomain(row),
      items: row.items.map(orderItemToDomain),
      statusHistory: row.statusHistory.map(orderStatusHistoryToDomain),
    };
  }

  async findByOrderNumber(orderNumber: string): Promise<Order | null> {
    const row = await prisma.order.findUnique({ where: { orderNumber } });
    return row ? orderToDomain(row) : null;
  }

  async findByCheckoutSessionId(checkoutSessionId: string): Promise<Order | null> {
    const row = await prisma.order.findUnique({ where: { checkoutSessionId } });
    return row ? orderToDomain(row) : null;
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<Order | null> {
    const row = await prisma.order.findUnique({ where: { paymentIntentId } });
    return row ? orderToDomain(row) : null;
  }

  async list(filter: OrderListFilter): Promise<{ items: Order[]; nextCursor: string | null }> {
    const rows = await prisma.order.findMany({
      where: {
        customerId: filter.customerId,
        guestToken: filter.guestToken,
        status: filter.status,
      },
      orderBy: { id: 'asc' },
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    return {
      items: page.map(orderToDomain),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async listRecentlyPaid(since: Date): Promise<Order[]> {
    const rows = await prisma.order.findMany({
      where: { status: { not: 'PENDING_PAYMENT' }, updatedAt: { gte: since } },
    });
    return rows.map(orderToDomain);
  }

  /**
   * Idempotent on `checkoutSessionId`/`paymentIntentId` under real
   * concurrency (ADR-009 decision 4) — same P2002-catch-and-reread
   * race-safety pattern every prior phase's idempotency guarantee uses.
   * `nextval('commerce.order_number_seq')` is drawn inside the same
   * transaction as the insert so a losing concurrent caller's draw is
   * simply never used (Postgres sequences are not transactional/
   * rollback-safe by design — a "gap" in the number sequence from a lost
   * race is expected and harmless, uniqueness is all that's guaranteed).
   */
  async create(props: {
    checkoutSessionId: string;
    paymentIntentId: string;
    customerId?: string | null;
    guestToken?: string | null;
    source?: OrderSource;
    currency: string;
    subtotal: bigint;
    discountTotal: bigint;
    taxTotal: bigint;
    shippingTotal: bigint;
    grandTotal: bigint;
    shippingAddressSnapshot: Record<string, unknown>;
    billingAddressSnapshot?: Record<string, unknown> | null;
    items: readonly {
      productSkuId?: string | null;
      skuSnapshot: string;
      nameSnapshot: string;
      unitPriceSnapshot: bigint;
      quantity: number;
      discountAmount: bigint;
      taxAmount: bigint;
      lineTotal: bigint;
    }[];
  }): Promise<Order> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const seqRows = await tx.$queryRaw<{ nextval: bigint }[]>(
          Prisma.sql`SELECT nextval('commerce.order_number_seq') AS nextval`,
        );
        const nextval = seqRows[0]?.nextval;
        if (nextval === undefined) throw new Error('order_number_seq.nextval() returned no row');
        const orderNumber = formatOrderNumber(nextval, new Date());
        return tx.order.create({
          data: {
            id: randomUUID(),
            orderNumber,
            checkoutSessionId: props.checkoutSessionId,
            paymentIntentId: props.paymentIntentId,
            customerId: props.customerId ?? null,
            guestToken: props.guestToken ?? null,
            source: props.source ?? 'STOREFRONT',
            currency: props.currency,
            subtotal: props.subtotal,
            discountTotal: props.discountTotal,
            taxTotal: props.taxTotal,
            shippingTotal: props.shippingTotal,
            grandTotal: props.grandTotal,
            shippingAddressSnapshot: props.shippingAddressSnapshot as Prisma.InputJsonValue,
            billingAddressSnapshot: (props.billingAddressSnapshot ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            items: {
              create: props.items.map((item) => ({
                id: randomUUID(),
                productSkuId: item.productSkuId ?? null,
                skuSnapshot: item.skuSnapshot,
                nameSnapshot: item.nameSnapshot,
                unitPriceSnapshot: item.unitPriceSnapshot,
                quantity: item.quantity,
                discountAmount: item.discountAmount,
                taxAmount: item.taxAmount,
                lineTotal: item.lineTotal,
              })),
            },
            statusHistory: {
              create: {
                id: randomUUID(),
                fromStatus: null,
                toStatus: 'PENDING_PAYMENT',
                changedBy: null,
                note: 'Order created from a verified payment',
              },
            },
          },
        });
      });
      return orderToDomain(row);
    } catch (error) {
      if (isUniqueViolationOn(error, 'checkout_session_id')) {
        const existing = await prisma.order.findUnique({
          where: { checkoutSessionId: props.checkoutSessionId },
        });
        if (existing) return orderToDomain(existing);
      }
      if (isUniqueViolationOn(error, 'payment_intent_id')) {
        const existing = await prisma.order.findUnique({
          where: { paymentIntentId: props.paymentIntentId },
        });
        if (existing) return orderToDomain(existing);
      }
      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    changedBy: string | null,
    note?: string | null,
    extra?: { cancelledAt?: Date; completedAt?: Date },
  ): Promise<Order> {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUniqueOrThrow({ where: { id } });
      const updated = await tx.order.update({
        where: { id },
        data: { status, cancelledAt: extra?.cancelledAt, completedAt: extra?.completedAt },
      });
      await tx.orderStatusHistory.create({
        data: {
          id: randomUUID(),
          orderId: id,
          fromStatus: current.status,
          toStatus: status,
          changedBy,
          note: note ?? null,
        },
      });
      return updated;
    });
    return orderToDomain(row);
  }

  async updatePaymentState(
    id: string,
    props: { paymentStatus: OrderPaymentStatus; paidTotal: bigint; refundedTotal: bigint },
  ): Promise<Order> {
    const row = await prisma.order.update({
      where: { id },
      data: {
        paymentStatus: props.paymentStatus,
        paidTotal: props.paidTotal,
        refundedTotal: props.refundedTotal,
      },
    });
    return orderToDomain(row);
  }

  async updateFulfillmentStatus(
    id: string,
    fulfillmentStatus: OrderFulfillmentStatus,
  ): Promise<Order> {
    const row = await prisma.order.update({ where: { id }, data: { fulfillmentStatus } });
    return orderToDomain(row);
  }
}
