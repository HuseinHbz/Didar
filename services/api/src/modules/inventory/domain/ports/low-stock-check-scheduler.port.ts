export const LOW_STOCK_CHECK_SCHEDULER = Symbol('LOW_STOCK_CHECK_SCHEDULER');

/** Schedules a re-evaluation of a SKU+warehouse's low-stock status —
 * called after any mutation that can only ever *decrease* available
 * quantity (reserve, adjustment, transfer dispatch). The BullMQ-backed
 * implementation collapses repeated calls for the same SKU+warehouse into
 * one pending check (job id = `skuId:warehouseId`). */
export interface LowStockCheckSchedulerPort {
  scheduleCheck(productSkuId: string, warehouseId: string): Promise<void>;
}
