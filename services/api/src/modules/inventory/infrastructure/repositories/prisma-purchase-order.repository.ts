import { randomUUID } from 'node:crypto';

import {
  prisma,
  type PurchaseOrder as PrismaPurchaseOrder,
  type PurchaseOrderItem as PrismaPurchaseOrderItem,
} from '@iecp/database';
import { Injectable } from '@nestjs/common';

import { PurchaseOrderItem } from '../../domain/entities/purchase-order-item.entity';
import { PurchaseOrder } from '../../domain/entities/purchase-order.entity';
import type {
  ListPurchaseOrdersFilter,
  PurchaseOrderRepositoryPort,
  PurchaseOrderWithItems,
} from '../../domain/ports/purchase-order.repository.port';
import {
  PurchaseOrderLineValidator,
  type PurchaseOrderLineInput,
} from '../../domain/services/purchase-order-line-validator';
import { PurchaseOrderStateMachine } from '../../domain/services/purchase-order-state-machine';
import { mutateInventoryItem } from '../inventory-item-mutator';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaPurchaseOrderRepository implements PurchaseOrderRepositoryPort {
  async findById(id: string): Promise<PurchaseOrderWithItems | null> {
    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return null;
    const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
    return { purchaseOrder: toDomain(po), items: items.map(itemToDomain) };
  }

  async list(
    filter: ListPurchaseOrdersFilter,
  ): Promise<{ items: PurchaseOrder[]; nextCursor: string | null }> {
    const cursorClause = filter.cursor ? decodeCursor(filter.cursor) : null;
    const where = {
      ...(filter.status !== undefined && { status: filter.status }),
      ...(filter.supplierId !== undefined && { supplierId: filter.supplierId }),
      ...(filter.warehouseId !== undefined && { warehouseId: filter.warehouseId }),
    };
    const rows = await prisma.purchaseOrder.findMany({
      where: cursorClause
        ? {
            ...where,
            OR: [
              { createdAt: { lt: new Date(cursorClause.sortValue) } },
              { createdAt: new Date(cursorClause.sortValue), id: { lt: cursorClause.id } },
            ],
          }
        : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });
    const { page, hasMore } = splitPage(rows, filter.limit);
    const last = page.at(-1);
    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    };
  }

  async create(props: {
    poNumber: string;
    supplierId: string;
    warehouseId: string;
    createdBy?: string | null;
    notes?: string | null;
    items: { productSkuId: string; orderedQuantity: number; unitCost: bigint }[];
  }): Promise<PurchaseOrderWithItems> {
    const lineInputs: PurchaseOrderLineInput[] = props.items.map((item) => ({
      productSkuId: item.productSkuId,
      orderedQuantity: item.orderedQuantity,
      unitCost: item.unitCost,
    }));
    PurchaseOrderLineValidator.assertValid(lineInputs);
    PurchaseOrderStateMachine.assertTransition('DRAFT', 'SUBMITTED');

    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          id: randomUUID(),
          poNumber: props.poNumber,
          supplierId: props.supplierId,
          warehouseId: props.warehouseId,
          status: 'SUBMITTED',
          createdBy: props.createdBy ?? null,
          notes: props.notes ?? null,
        },
      });
      const items = await Promise.all(
        props.items.map((item) =>
          tx.purchaseOrderItem.create({
            data: {
              id: randomUUID(),
              purchaseOrderId: po.id,
              productSkuId: item.productSkuId,
              orderedQuantity: item.orderedQuantity,
              unitCost: item.unitCost,
            },
          }),
        ),
      );
      return { purchaseOrder: toDomain(po), items: items.map(itemToDomain) };
    });
  }

  async approve(id: string, approvedBy: string): Promise<PurchaseOrderWithItems> {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
      PurchaseOrderStateMachine.assertTransition(po.status, 'APPROVED');

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy, approvedAt: new Date() },
      });
      const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
      return { purchaseOrder: toDomain(updated), items: items.map(itemToDomain) };
    });
  }

  /** True only if every line in this batch already has a matching
   * `InventoryLedger.idempotencyKey` row — i.e. this exact receipt was
   * already fully applied by an earlier attempt (or by a concurrent
   * caller using the same key). Used both as the P2002 recovery check
   * (see `receive()` below) and, critically, as the *first* thing
   * `receive()` checks on ANY failure — not only P2002 — because a
   * receipt that completes a purchase order moves it straight to the
   * terminal `RECEIVED` status; a legitimate retry of that exact call
   * would otherwise fail `PurchaseOrderStateMachine.assertCanReceive`
   * (RECEIVED can't receive again) before it ever reaches the ledger
   * insert that would have raised the P2002 the old recovery path
   * depended on. Checking ledger rows directly sidesteps that ordering
   * problem entirely: it doesn't matter whether the current attempt
   * failed on the state guard or on the unique constraint, only whether
   * this batch's keys are already on the ledger.
   */
  private async wasAlreadyApplied(
    idempotencyKeyPrefix: string,
    items: { productSkuId: string }[],
  ): Promise<boolean> {
    const keys = items.map((item) => `${idempotencyKeyPrefix}__${item.productSkuId}`);
    const count = await prisma.inventoryLedger.count({
      where: { idempotencyKey: { in: keys } },
    });
    return count === keys.length;
  }

  /** See the port's own doc comment for the full idempotency account.
   * Every line's `receiveStock`-equivalent mutation (row-lock + ledger
   * write, via the shared `mutateInventoryItem`) and this order's own
   * `PurchaseOrderItem.receivedQuantity` update happen inside the same
   * transaction as each other — a partial failure on line 2 of 3 rolls
   * line 1 back too, never leaving a half-applied receipt. */
  async receive(
    id: string,
    props: {
      actorUserId?: string | null;
      correlationId: string;
      idempotencyKeyPrefix?: string | null;
      items: { productSkuId: string; receivedQuantity: number; locationId: string }[];
    },
  ): Promise<PurchaseOrderWithItems> {
    try {
      return await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
        PurchaseOrderStateMachine.assertCanReceive(po.status);

        const existingItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: id },
        });
        const lineBySkuId = new Map(existingItems.map((item) => [item.productSkuId, item]));

        for (const receipt of props.items) {
          const line = lineBySkuId.get(receipt.productSkuId);
          if (!line) {
            throw new Error(`Purchase order ${id} has no line for SKU ${receipt.productSkuId}`);
          }
          const outstanding = line.orderedQuantity - line.receivedQuantity;
          PurchaseOrderLineValidator.assertValidReceipt(
            receipt.receivedQuantity,
            outstanding,
            receipt.productSkuId,
          );

          const inventoryItem = await tx.inventoryItem.upsert({
            where: {
              productSkuId_warehouseId_locationId: {
                productSkuId: receipt.productSkuId,
                warehouseId: po.warehouseId,
                locationId: receipt.locationId,
              },
            },
            update: {},
            create: {
              id: randomUUID(),
              productSkuId: receipt.productSkuId,
              warehouseId: po.warehouseId,
              locationId: receipt.locationId,
            },
          });

          await mutateInventoryItem(
            tx,
            inventoryItem.id,
            { onHand: receipt.receivedQuantity },
            'PURCHASE_RECEIPT',
            {
              quantity: receipt.receivedQuantity,
              referenceType: 'PURCHASE_ORDER',
              referenceId: id,
              actorUserId: props.actorUserId,
              correlationId: props.correlationId,
              idempotencyKey: props.idempotencyKeyPrefix
                ? `${props.idempotencyKeyPrefix}__${receipt.productSkuId}`
                : undefined,
            },
          );

          await tx.purchaseOrderItem.update({
            where: { id: line.id },
            data: { receivedQuantity: { increment: receipt.receivedQuantity } },
          });
        }

        const updatedItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: id },
        });
        const allFullyReceived = updatedItems.every(
          (item) => item.receivedQuantity >= item.orderedQuantity,
        );
        const nextStatus = PurchaseOrderStateMachine.nextStatusAfterReceipt(allFullyReceived);

        const updatedPo = await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: nextStatus,
            ...(nextStatus === 'RECEIVED' && { receivedAt: new Date() }),
          },
        });

        return { purchaseOrder: toDomain(updatedPo), items: updatedItems.map(itemToDomain) };
      });
    } catch (error) {
      // Broader than the plain P2002-catch-and-reread convention
      // `receiveStock()` itself uses: a retry of a receipt that already
      // completed this order fails `assertCanReceive` (a
      // `InvalidPurchaseOrderTransitionError`, not a P2002) before it can
      // ever collide on the ledger's unique constraint — see
      // `wasAlreadyApplied`'s own doc comment. Checking the ledger
      // directly, regardless of which error surfaced, covers both
      // failure shapes with one recovery path; any error that isn't
      // actually this batch replaying still propagates unchanged.
      if (
        props.idempotencyKeyPrefix &&
        (await this.wasAlreadyApplied(props.idempotencyKeyPrefix, props.items))
      ) {
        const current = await this.findById(id);
        if (current) return current;
      }
      throw error;
    }
  }

  async cancel(id: string): Promise<PurchaseOrderWithItems> {
    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
      PurchaseOrderStateMachine.assertCanCancel(po.status);

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
      return { purchaseOrder: toDomain(updated), items: items.map(itemToDomain) };
    });
  }
}

function toDomain(row: PrismaPurchaseOrder): PurchaseOrder {
  return PurchaseOrder.create({
    id: row.id,
    poNumber: row.poNumber,
    supplierId: row.supplierId,
    warehouseId: row.warehouseId,
    status: row.status,
    createdBy: row.createdBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    cancelledAt: row.cancelledAt,
    receivedAt: row.receivedAt,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function itemToDomain(row: PrismaPurchaseOrderItem): PurchaseOrderItem {
  return PurchaseOrderItem.create({
    id: row.id,
    purchaseOrderId: row.purchaseOrderId,
    productSkuId: row.productSkuId,
    orderedQuantity: row.orderedQuantity,
    receivedQuantity: row.receivedQuantity,
    unitCost: row.unitCost,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
