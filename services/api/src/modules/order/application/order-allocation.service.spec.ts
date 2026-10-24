import type { StockSaleService } from '../../inventory/application/stock-sale.service';

import { OrderAllocationService } from './order-allocation.service';

const LINE = {
  orderId: 'order-1',
  productSkuId: 'sku-1',
  quantity: 2,
  checkoutReservationId: 'res-1',
};
const REFERENCE = { referenceType: 'ORDER', referenceId: 'order-1' };

function build() {
  const sales = {
    sellReserved: jest.fn(),
    acquireAndSell: jest.fn(),
  } as unknown as jest.Mocked<Pick<StockSaleService, 'sellReserved' | 'acquireAndSell'>>;
  return { sales, service: new OrderAllocationService(sales as unknown as StockSaleService) };
}

describe('OrderAllocationService.allocateLine', () => {
  it("sells the checkout's own reservation first and stops there", async () => {
    const { sales, service } = build();
    sales.sellReserved.mockResolvedValue({ kind: 'SOLD' });

    await expect(service.allocateLine(LINE)).resolves.toEqual({ kind: 'ALLOCATED' });
    expect(sales.sellReserved).toHaveBeenCalledWith('res-1', REFERENCE);
    expect(sales.acquireAndSell).not.toHaveBeenCalled();
  });

  it('re-acquires under a deterministic order-scoped key when the hold was released', async () => {
    const { sales, service } = build();
    sales.sellReserved.mockResolvedValue({ kind: 'NOT_HELD', status: 'RELEASED' });
    sales.acquireAndSell.mockResolvedValue({ kind: 'SOLD' });

    await expect(service.allocateLine(LINE)).resolves.toEqual({ kind: 'ALLOCATED' });
    expect(sales.acquireAndSell).toHaveBeenCalledWith({
      productSkuId: 'sku-1',
      quantity: 2,
      sourceType: 'ORDER',
      sourceId: 'order-1',
      idempotencyKey: 'order__order-1__sku-1',
      reference: REFERENCE,
    });
  });

  it('re-acquires when the line has no checkout reservation at all (an exception retry)', async () => {
    const { sales, service } = build();
    sales.acquireAndSell.mockResolvedValue({ kind: 'SOLD' });

    await expect(service.allocateLine({ ...LINE, checkoutReservationId: null })).resolves.toEqual({
      kind: 'ALLOCATED',
    });
    expect(sales.sellReserved).not.toHaveBeenCalled();
  });

  it('reports SHORT, with the reason, when re-acquiring finds no stock', async () => {
    const { sales, service } = build();
    sales.sellReserved.mockResolvedValue({ kind: 'NOT_HELD', status: 'EXPIRED' });
    sales.acquireAndSell.mockResolvedValue({
      kind: 'SHORT',
      reason: 'no warehouse has 2 unit(s) available',
    });

    await expect(service.allocateLine(LINE)).resolves.toEqual({
      kind: 'SHORT',
      reason: 'no warehouse has 2 unit(s) available',
    });
  });

  it('does NOT re-acquire when the checkout reservation is ACTIVE but cannot be sold — that would hold the stock twice', async () => {
    const { sales, service } = build();
    sales.sellReserved.mockResolvedValue({ kind: 'SHORT', reason: 'only 0 on hand' });

    await expect(service.allocateLine(LINE)).resolves.toEqual({
      kind: 'SHORT',
      reason: 'only 0 on hand',
    });
    expect(sales.acquireAndSell).not.toHaveBeenCalled();
  });

  it('lets an unexpected failure propagate so the conversion fails and the sweep retries it', async () => {
    const { sales, service } = build();
    sales.sellReserved.mockRejectedValue(new Error('connection terminated'));

    await expect(service.allocateLine(LINE)).rejects.toThrow('connection terminated');
  });
});
