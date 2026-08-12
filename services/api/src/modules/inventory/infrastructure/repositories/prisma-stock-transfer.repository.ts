import { randomUUID } from 'node:crypto';

import {
  prisma,
  type StockTransfer as PrismaStockTransfer,
  type StockTransferItem as PrismaStockTransferItem,
} from '@iecp/database';
import { Injectable } from '@nestjs/common';

import { StockTransferItem } from '../../domain/entities/stock-transfer-item.entity';
import { StockTransfer } from '../../domain/entities/stock-transfer.entity';
import type {
  ListTransfersFilter,
  StockTransferRepositoryPort,
  StockTransferWithItems,
} from '../../domain/ports/stock-transfer.repository.port';
import { TransferStateMachine } from '../../domain/services/transfer-state-machine';
import { mutateInventoryItem } from '../inventory-item-mutator';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaStockTransferRepository implements StockTransferRepositoryPort {
  async findById(id: string): Promise<StockTransferWithItems | null> {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id } });
    if (!transfer) return null;
    const items = await prisma.stockTransferItem.findMany({ where: { transferId: id } });
    return { transfer: transferToDomain(transfer), items: items.map(itemToDomain) };
  }

  async list(
    filter: ListTransfersFilter,
  ): Promise<{ items: StockTransfer[]; nextCursor: string | null }> {
    const cursorClause = filter.cursor ? decodeCursor(filter.cursor) : null;
    const where = {
      ...(filter.status !== undefined && { status: filter.status }),
      ...(filter.sourceWarehouseId !== undefined && {
        sourceWarehouseId: filter.sourceWarehouseId,
      }),
      ...(filter.destinationWarehouseId !== undefined && {
        destinationWarehouseId: filter.destinationWarehouseId,
      }),
    };
    const rows = await prisma.stockTransfer.findMany({
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
      items: page.map(transferToDomain),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    };
  }

  async create(props: {
    referenceNumber: string;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    requestedBy?: string | null;
    items: { productSkuId: string; requestedQuantity: number }[];
  }): Promise<StockTransferWithItems> {
    if (props.items.length === 0) {
      throw new Error('A transfer must have at least one item');
    }
    TransferStateMachine.assertTransition('DRAFT', 'REQUESTED');

    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.create({
        data: {
          id: randomUUID(),
          referenceNumber: props.referenceNumber,
          sourceWarehouseId: props.sourceWarehouseId,
          destinationWarehouseId: props.destinationWarehouseId,
          status: 'REQUESTED',
          requestedBy: props.requestedBy ?? null,
        },
      });
      const items = await Promise.all(
        props.items.map((item) =>
          tx.stockTransferItem.create({
            data: {
              id: randomUUID(),
              transferId: transfer.id,
              productSkuId: item.productSkuId,
              requestedQuantity: item.requestedQuantity,
            },
          }),
        ),
      );
      return { transfer: transferToDomain(transfer), items: items.map(itemToDomain) };
    });
  }

  async approve(
    id: string,
    props: { approvedBy: string; items?: { productSkuId: string; approvedQuantity: number }[] },
  ): Promise<StockTransferWithItems> {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUniqueOrThrow({ where: { id } });
      TransferStateMachine.assertTransition(transfer.status, 'APPROVED');

      const existingItems = await tx.stockTransferItem.findMany({ where: { transferId: id } });
      const approvedBySkuId = new Map(
        (props.items ?? []).map((i) => [i.productSkuId, i.approvedQuantity]),
      );
      await Promise.all(
        existingItems.map((item) =>
          tx.stockTransferItem.update({
            where: { id: item.id },
            data: {
              approvedQuantity: approvedBySkuId.get(item.productSkuId) ?? item.requestedQuantity,
            },
          }),
        ),
      );

      const updated = await tx.stockTransfer.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: props.approvedBy },
      });
      const items = await tx.stockTransferItem.findMany({ where: { transferId: id } });
      return { transfer: transferToDomain(updated), items: items.map(itemToDomain) };
    });
  }

  async dispatch(
    id: string,
    props: {
      actorUserId?: string | null;
      correlationId: string;
      items?: { productSkuId: string; dispatchedQuantity: number }[];
    },
  ): Promise<StockTransferWithItems> {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUniqueOrThrow({ where: { id } });
      // APPROVED -> PICKING -> DISPATCHED in one call — see this module's
      // README for why there's no separate scan-driven picking endpoint
      // this phase.
      TransferStateMachine.assertTransition(transfer.status, 'PICKING');
      TransferStateMachine.assertTransition('PICKING', 'DISPATCHED');

      const existingItems = await tx.stockTransferItem.findMany({ where: { transferId: id } });
      const dispatchedBySkuId = new Map(
        (props.items ?? []).map((i) => [i.productSkuId, i.dispatchedQuantity]),
      );

      for (const item of existingItems) {
        const quantity =
          dispatchedBySkuId.get(item.productSkuId) ??
          item.approvedQuantity ??
          item.requestedQuantity;
        if (quantity <= 0) continue;

        const sourceCandidates = await tx.inventoryItem.findMany({
          where: { productSkuId: item.productSkuId, warehouseId: transfer.sourceWarehouseId },
          orderBy: { availableQuantity: 'desc' },
        });
        const sourceItem = sourceCandidates[0];
        if (!sourceItem) {
          throw new Error(
            `No stock for SKU ${item.productSkuId} at source warehouse ${transfer.sourceWarehouseId}`,
          );
        }
        // Two TRANSFER_OUT entries describe the same physical event: on-hand
        // leaves the source, and the destination's in-transit bucket picks
        // it up — see this module's README "Transfers" section.
        await mutateInventoryItem(tx, sourceItem.id, { onHand: -quantity }, 'TRANSFER_OUT', {
          quantity,
          referenceType: 'STOCK_TRANSFER',
          referenceId: id,
          actorUserId: props.actorUserId,
          correlationId: props.correlationId,
        });

        const destinationLocation = await tx.warehouseLocation.findFirst({
          where: { warehouseId: transfer.destinationWarehouseId, active: true },
          orderBy: { code: 'asc' },
        });
        if (!destinationLocation) {
          throw new Error(
            `Destination warehouse ${transfer.destinationWarehouseId} has no active location`,
          );
        }
        const destinationItem = await tx.inventoryItem.upsert({
          where: {
            productSkuId_warehouseId_locationId: {
              productSkuId: item.productSkuId,
              warehouseId: transfer.destinationWarehouseId,
              locationId: destinationLocation.id,
            },
          },
          update: {},
          create: {
            id: randomUUID(),
            productSkuId: item.productSkuId,
            warehouseId: transfer.destinationWarehouseId,
            locationId: destinationLocation.id,
          },
        });
        await mutateInventoryItem(tx, destinationItem.id, { inTransit: quantity }, 'TRANSFER_OUT', {
          quantity,
          referenceType: 'STOCK_TRANSFER',
          referenceId: id,
          actorUserId: props.actorUserId,
          correlationId: props.correlationId,
        });

        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { dispatchedQuantity: quantity },
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id },
        data: { status: 'DISPATCHED', dispatchedAt: new Date() },
      });
      const items = await tx.stockTransferItem.findMany({ where: { transferId: id } });
      return { transfer: transferToDomain(updated), items: items.map(itemToDomain) };
    });
  }

  async receive(
    id: string,
    props: {
      actorUserId?: string | null;
      correlationId: string;
      items: { productSkuId: string; receivedQuantity: number }[];
    },
  ): Promise<StockTransferWithItems> {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUniqueOrThrow({ where: { id } });
      // DISPATCHED -> IN_TRANSIT -> {PARTIALLY_RECEIVED|RECEIVED} — no
      // separate "mark in transit" endpoint this phase (see README).
      if (transfer.status === 'DISPATCHED') {
        TransferStateMachine.assertTransition('DISPATCHED', 'IN_TRANSIT');
      }

      const existingItems = await tx.stockTransferItem.findMany({ where: { transferId: id } });
      const receivedBySkuId = new Map(props.items.map((i) => [i.productSkuId, i.receivedQuantity]));

      for (const item of existingItems) {
        const quantity = receivedBySkuId.get(item.productSkuId);
        if (!quantity || quantity <= 0) continue;

        const destinationItem = await tx.inventoryItem.findFirstOrThrow({
          where: { productSkuId: item.productSkuId, warehouseId: transfer.destinationWarehouseId },
          orderBy: { inTransitQuantity: 'desc' },
        });
        await mutateInventoryItem(
          tx,
          destinationItem.id,
          { inTransit: -quantity, onHand: quantity },
          'TRANSFER_IN',
          {
            quantity,
            referenceType: 'STOCK_TRANSFER',
            referenceId: id,
            actorUserId: props.actorUserId,
            correlationId: props.correlationId,
          },
        );

        const newReceived = (item.receivedQuantity ?? 0) + quantity;
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { receivedQuantity: newReceived },
        });
      }

      const refreshedItems = await tx.stockTransferItem.findMany({ where: { transferId: id } });
      const fullyReceived = refreshedItems.every((item) => {
        const dispatched =
          item.dispatchedQuantity ?? item.approvedQuantity ?? item.requestedQuantity;
        return (item.receivedQuantity ?? 0) >= dispatched;
      });
      const nextStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      const currentStatus = transfer.status === 'DISPATCHED' ? 'IN_TRANSIT' : transfer.status;
      TransferStateMachine.assertTransition(currentStatus, nextStatus);

      const updated = await tx.stockTransfer.update({
        where: { id },
        data: { status: nextStatus, receivedAt: fullyReceived ? new Date() : transfer.receivedAt },
      });
      return { transfer: transferToDomain(updated), items: refreshedItems.map(itemToDomain) };
    });
  }

  async cancel(id: string): Promise<StockTransferWithItems> {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUniqueOrThrow({ where: { id } });
      TransferStateMachine.assertTransition(transfer.status, 'CANCELLED');
      const updated = await tx.stockTransfer.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      const items = await tx.stockTransferItem.findMany({ where: { transferId: id } });
      return { transfer: transferToDomain(updated), items: items.map(itemToDomain) };
    });
  }
}

function transferToDomain(row: PrismaStockTransfer): StockTransfer {
  return StockTransfer.create({
    id: row.id,
    referenceNumber: row.referenceNumber,
    sourceWarehouseId: row.sourceWarehouseId,
    destinationWarehouseId: row.destinationWarehouseId,
    status: row.status,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    dispatchedAt: row.dispatchedAt,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function itemToDomain(row: PrismaStockTransferItem): StockTransferItem {
  return StockTransferItem.create({
    id: row.id,
    transferId: row.transferId,
    productSkuId: row.productSkuId,
    requestedQuantity: row.requestedQuantity,
    approvedQuantity: row.approvedQuantity,
    dispatchedQuantity: row.dispatchedQuantity,
    receivedQuantity: row.receivedQuantity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
