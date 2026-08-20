import { randomUUID } from 'node:crypto';

import { Prisma, prisma, type PrismaClient } from '@iecp/database';
import type {
  ReturnItemCondition,
  ReturnReason,
  ReturnResolution,
  ReturnStatus,
} from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { ReturnItem } from '../../domain/entities/return-item.entity';
import type { ReturnRequest } from '../../domain/entities/return-request.entity';
import type {
  ReturnListFilter,
  ReturnRepositoryPort,
  ReturnRequestWithDetail,
  StatusUpdateResult,
} from '../../domain/ports/return.repository.port';
import { ReturnQuantityValidator } from '../../domain/services/return-quantity-validator';
import { ReturnStateMachine } from '../../domain/services/return-state-machine';
import {
  returnItemToDomain,
  returnRequestToDomain,
  returnStatusHistoryToDomain,
} from '../return.mapper';

function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.['target'] as string[] | undefined)?.includes(column) === true
  );
}

/** `RET-YYYYMMDD-NNNNNN` — same shape `formatOrderNumber` already
 * established for `Order.orderNumber`. */
function formatReturnNumber(seq: bigint, drawnAt: Date): string {
  const y = drawnAt.getUTCFullYear();
  const m = String(drawnAt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(drawnAt.getUTCDate()).padStart(2, '0');
  return `RET-${y}${m}${d}-${seq.toString().padStart(6, '0')}`;
}

interface Cursor {
  requestedAt: string;
  id: string;
}

function encodeCursor(row: { requestedAt: Date; id: string }): string {
  const cursor: Cursor = { requestedAt: row.requestedAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(encoded: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'requestedAt' in parsed &&
      'id' in parsed &&
      typeof (parsed as Cursor).requestedAt === 'string' &&
      typeof (parsed as Cursor).id === 'string'
    ) {
      return parsed as Cursor;
    }
    throw new Error('shape mismatch');
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Row-locks `commerce.order_items` (`SELECT ... FOR UPDATE`, the same
 * technique `lockAndSumFulfilled` established for `Fulfillment`) and
 * re-sums every quantity named across every non-`REJECTED`/non-
 * `CANCELLED` `ReturnRequest`'s `ReturnItem` rows for that item — both
 * inside the caller's own transaction, so two truly concurrent return
 * requests targeting the same `OrderItem` can never both pass
 * `ReturnQuantityValidator` (ADR-012 decision 5). */
async function lockAndSumReturned(
  tx: TxClient,
  orderItemId: string,
): Promise<{ orderedQuantity: number; alreadyReturnedQuantity: number }> {
  const rows = await tx.$queryRaw<{ id: string; quantity: number }[]>(
    Prisma.sql`SELECT id, quantity FROM commerce.order_items WHERE id = ${orderItemId}::uuid FOR UPDATE`,
  );
  const row = rows[0];
  if (!row) throw new Error(`OrderItem ${orderItemId} not found`);

  const sumRows = await tx.$queryRaw<{ total: bigint | null }[]>(
    Prisma.sql`SELECT COALESCE(SUM(ri.quantity), 0)::bigint AS total
      FROM commerce.return_items ri
      JOIN commerce.return_requests rr ON rr.id = ri.return_request_id
      WHERE ri.order_item_id = ${orderItemId}::uuid
        AND rr.status NOT IN ('REJECTED', 'CANCELLED')`,
  );
  const alreadyReturnedQuantity = Number(sumRows[0]?.total ?? 0n);
  return { orderedQuantity: row.quantity, alreadyReturnedQuantity };
}

@Injectable()
export class PrismaReturnRepository implements ReturnRepositoryPort {
  async findById(id: string): Promise<ReturnRequestWithDetail | null> {
    const row = await prisma.returnRequest.findUnique({
      where: { id },
      include: { items: true, statusHistory: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    return {
      request: returnRequestToDomain(row),
      items: row.items.map(returnItemToDomain),
      history: row.statusHistory.map(returnStatusHistoryToDomain),
    };
  }

  async findByReturnNumber(returnNumber: string): Promise<ReturnRequest | null> {
    const row = await prisma.returnRequest.findUnique({ where: { returnNumber } });
    return row ? returnRequestToDomain(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<ReturnRequest | null> {
    const row = await prisma.returnRequest.findUnique({ where: { idempotencyKey: key } });
    return row ? returnRequestToDomain(row) : null;
  }

  async list(
    filter: ReturnListFilter,
  ): Promise<{ items: ReturnRequest[]; nextCursor: string | null }> {
    const where: Prisma.ReturnRequestWhereInput = {
      ...(filter.customerId && { customerId: filter.customerId }),
      ...(filter.guestToken && { guestToken: filter.guestToken }),
      ...(filter.orderId && { orderId: filter.orderId }),
      ...(filter.status && { status: filter.status }),
      ...((filter.requestedFrom !== undefined || filter.requestedTo !== undefined) && {
        requestedAt: {
          ...(filter.requestedFrom && { gte: filter.requestedFrom }),
          ...(filter.requestedTo && { lte: filter.requestedTo }),
        },
      }),
    };

    if (filter.cursor) {
      const { requestedAt, id } = decodeCursor(filter.cursor);
      where.OR = [
        { requestedAt: { lt: new Date(requestedAt) } },
        { requestedAt: new Date(requestedAt), id: { lt: id } },
      ];
    }

    const rows = await prisma.returnRequest.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(returnRequestToDomain),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }

  async sumReturnedQuantity(orderItemId: string): Promise<number> {
    const rows = await prisma.$queryRaw<{ total: bigint | null }[]>(
      Prisma.sql`SELECT COALESCE(SUM(ri.quantity), 0)::bigint AS total
        FROM commerce.return_items ri
        JOIN commerce.return_requests rr ON rr.id = ri.return_request_id
        WHERE ri.order_item_id = ${orderItemId}::uuid
          AND rr.status NOT IN ('REJECTED', 'CANCELLED')`,
    );
    return Number(rows[0]?.total ?? 0n);
  }

  async create(props: {
    orderId: string;
    customerId?: string | null;
    guestToken?: string | null;
    reason: ReturnReason;
    reasonNote?: string | null;
    resolution?: ReturnResolution;
    items: readonly { orderItemId: string; quantity: number }[];
    idempotencyKey?: string | null;
  }): Promise<ReturnRequest> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        for (const item of props.items) {
          const { orderedQuantity, alreadyReturnedQuantity } = await lockAndSumReturned(
            tx,
            item.orderItemId,
          );
          ReturnQuantityValidator.assertReturnable(
            item.orderItemId,
            orderedQuantity,
            alreadyReturnedQuantity,
            item.quantity,
          );
        }

        const seqRows = await tx.$queryRaw<{ nextval: bigint }[]>(
          Prisma.sql`SELECT nextval('commerce.return_number_seq') AS nextval`,
        );
        const nextval = seqRows[0]?.nextval;
        if (nextval === undefined) throw new Error('return_number_seq.nextval() returned no row');
        const returnNumber = formatReturnNumber(nextval, new Date());

        return tx.returnRequest.create({
          data: {
            id: randomUUID(),
            returnNumber,
            orderId: props.orderId,
            customerId: props.customerId ?? null,
            guestToken: props.guestToken ?? null,
            reason: props.reason,
            reasonNote: props.reasonNote ?? null,
            resolution: props.resolution ?? 'REFUND',
            idempotencyKey: props.idempotencyKey ?? null,
            items: {
              create: props.items.map((item) => ({
                id: randomUUID(),
                orderItemId: item.orderItemId,
                quantity: item.quantity,
              })),
            },
            statusHistory: {
              create: {
                id: randomUUID(),
                fromStatus: null,
                toStatus: 'REQUESTED',
                changedBy: props.customerId ?? null,
                note: 'Return requested',
              },
            },
          },
        });
      });
      return returnRequestToDomain(row);
    } catch (error) {
      if (props.idempotencyKey && isUniqueViolationOn(error, 'idempotency_key')) {
        const existing = await prisma.returnRequest.findUnique({
          where: { idempotencyKey: props.idempotencyKey },
        });
        if (existing) return returnRequestToDomain(existing);
      }
      throw error;
    }
  }

  /** ADR-012 decision 5/9 — row-locks the return, re-checks
   * `ReturnStateMachine` against the *locked* status before writing. See
   * the port's own doc comment for the full contract. */
  async updateStatus(
    id: string,
    status: ReturnStatus,
    changedBy: string | null,
    note?: string | null,
    extra?: {
      warehouseId?: string | null;
      locationId?: string | null;
      rejectionReason?: string | null;
      approvedAt?: Date;
      receivedAt?: Date;
      inspectedAt?: Date;
      refundedAt?: Date;
      completedAt?: Date;
      rejectedAt?: Date;
      cancelledAt?: Date;
    },
  ): Promise<StatusUpdateResult<ReturnRequest>> {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: ReturnStatus }[]>(
        Prisma.sql`SELECT status FROM commerce.return_requests WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const currentStatus = locked[0]?.status;
      if (currentStatus === undefined) throw new Error(`ReturnRequest ${id} not found`);

      if (ReturnStateMachine.isNoOp(currentStatus, status)) {
        const unchanged = await tx.returnRequest.findUniqueOrThrow({ where: { id } });
        return { row: unchanged, transitioned: false };
      }
      ReturnStateMachine.assertTransition(currentStatus, status);

      const updated = await tx.returnRequest.update({
        where: { id },
        data: {
          status,
          warehouseId: extra?.warehouseId,
          locationId: extra?.locationId,
          rejectionReason: extra?.rejectionReason,
          approvedAt: extra?.approvedAt,
          receivedAt: extra?.receivedAt,
          inspectedAt: extra?.inspectedAt,
          refundedAt: extra?.refundedAt,
          completedAt: extra?.completedAt,
          rejectedAt: extra?.rejectedAt,
          cancelledAt: extra?.cancelledAt,
        },
      });
      await tx.returnStatusHistory.create({
        data: {
          id: randomUUID(),
          returnRequestId: id,
          fromStatus: currentStatus,
          toStatus: status,
          changedBy,
          note: note ?? null,
        },
      });
      return { row: updated, transitioned: true };
    });
    return { entity: returnRequestToDomain(result.row), transitioned: result.transitioned };
  }

  async recordInspection(
    returnRequestId: string,
    items: readonly {
      returnItemId: string;
      condition: ReturnItemCondition;
      refundAmount: bigint;
    }[],
  ): Promise<ReturnItem[]> {
    const updated = await prisma.$transaction(
      items.map((item) =>
        prisma.returnItem.update({
          where: { id: item.returnItemId },
          data: { condition: item.condition, refundAmount: item.refundAmount },
        }),
      ),
    );
    return updated.map(returnItemToDomain);
  }
}
