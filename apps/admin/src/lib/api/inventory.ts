import type { StockTransferStatus } from '@iecp/types';

import type { Page } from './catalog';
import { apiRequest } from './client';

export type { StockTransferStatus };

export interface Warehouse {
  id: string;
  name: string;
  code: string;
}

export async function listWarehouses(): Promise<Page<Warehouse>> {
  return apiRequest<Page<Warehouse>>('/admin/inventory/warehouses', { query: { limit: 100 } });
}

export interface Adjustment {
  id: string;
  warehouseId: string;
  locationId: string;
  productSkuId: string;
  adjustmentType: 'POSITIVE' | 'NEGATIVE';
  quantity: number;
  reason: string;
  approvedBy: string | null;
  createdBy: string;
  createdAt: string;
}

export async function listAdjustments(
  warehouseId: string,
  params: { cursor?: string; limit?: number } = {},
): Promise<Page<Adjustment>> {
  return apiRequest<Page<Adjustment>>('/admin/inventory/adjustments', {
    query: { warehouseId, ...params },
  });
}

export interface CreateAdjustmentInput {
  warehouseId: string;
  locationId: string;
  productSkuId: string;
  adjustmentType: 'POSITIVE' | 'NEGATIVE';
  quantity: number;
  reason: string;
}

export async function createAdjustment(input: CreateAdjustmentInput): Promise<Adjustment> {
  return apiRequest<Adjustment>('/admin/inventory/adjustments', { method: 'POST', body: input });
}

export interface TransferItem {
  id: string;
  productSkuId: string;
  requestedQuantity: number;
  approvedQuantity: number | null;
  dispatchedQuantity: number | null;
  receivedQuantity: number | null;
}

export interface Transfer {
  id: string;
  referenceNumber: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  status: StockTransferStatus;
  requestedBy: string | null;
  approvedBy: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: TransferItem[];
}

export async function listTransfers(params: {
  status?: StockTransferStatus;
  cursor?: string;
  limit?: number;
}): Promise<Page<Transfer>> {
  return apiRequest<Page<Transfer>>('/admin/inventory/transfers', { query: params });
}

export async function getTransfer(id: string): Promise<Transfer> {
  return apiRequest<Transfer>(`/admin/inventory/transfers/${id}`);
}

export interface CreateTransferInput {
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  items: { productSkuId: string; requestedQuantity: number }[];
}

export async function createTransfer(input: CreateTransferInput): Promise<Transfer> {
  return apiRequest<Transfer>('/admin/inventory/transfers', { method: 'POST', body: input });
}

export async function approveTransfer(id: string): Promise<Transfer> {
  return apiRequest<Transfer>(`/admin/inventory/transfers/${id}/approve`, { method: 'POST' });
}

export async function dispatchTransfer(id: string): Promise<Transfer> {
  return apiRequest<Transfer>(`/admin/inventory/transfers/${id}/dispatch`, { method: 'POST' });
}

/** `ReceiveTransferDto.items` is required + non-empty (`ArrayMinSize(1)`)
 * — the caller must state exactly what arrived, one row per SKU. The
 * transfer-detail page builds this from the transfer's own already-
 * dispatched line items, defaulted to the full dispatched quantity, and
 * lets the operator adjust before confirming (a real partial-receipt
 * case, not invented — `PARTIALLY_RECEIVED` is a real status). */
export async function receiveTransfer(
  id: string,
  items: { productSkuId: string; receivedQuantity: number }[],
): Promise<Transfer> {
  return apiRequest<Transfer>(`/admin/inventory/transfers/${id}/receive`, {
    method: 'POST',
    body: { items },
  });
}
