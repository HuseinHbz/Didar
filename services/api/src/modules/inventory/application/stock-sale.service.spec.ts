import { InventoryReservation } from '../domain/entities/inventory-reservation.entity';
import { InsufficientStockError } from '../domain/services/available-quantity-calculator';
import {
  InvalidReservationOperationError,
  ReservationNotActiveError,
} from '../domain/services/reservation-rules';

import type { AllocationService } from './allocation.service';
import type { ReservationService } from './reservation.service';
import { StockSaleService } from './stock-sale.service';

const SKU = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '22222222-2222-4222-8222-222222222222';
const LOCATION = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';
const R1 = '55555555-5555-4555-8555-555555555551';
const R2 = '55555555-5555-4555-8555-555555555552';
const REFERENCE = { referenceType: 'ORDER', referenceId: 'order-1' };

function reservation(
  id: string,
  status: 'ACTIVE' | 'CONVERTED' | 'RELEASED' | 'EXPIRED',
): InventoryReservation {
  return InventoryReservation.create({
    id,
    productSkuId: SKU,
    warehouseId: WAREHOUSE,
    locationId: LOCATION,
    inventoryItemId: ITEM,
    quantity: 2,
    status,
    sourceType: 'ORDER',
    sourceId: 'order-1',
    idempotencyKey: `key-${id}`,
    expiresAt: null,
    releasedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

interface Fakes {
  reservations: jest.Mocked<
    Pick<ReservationService, 'findById' | 'findByIdempotencyKey' | 'convert' | 'reserve'>
  >;
  allocation: jest.Mocked<Pick<AllocationService, 'allocate'>>;
  service: StockSaleService;
}

function build(): Fakes {
  const reservations: Fakes['reservations'] = {
    findById: jest.fn(),
    findByIdempotencyKey: jest.fn(),
    convert: jest.fn(),
    reserve: jest.fn(),
  };
  const allocation: Fakes['allocation'] = { allocate: jest.fn() };
  const service = new StockSaleService(
    reservations as unknown as ReservationService,
    allocation as unknown as AllocationService,
  );
  return { reservations, allocation, service };
}

describe('StockSaleService', () => {
  describe('sellReserved', () => {
    it('sells an ACTIVE reservation', async () => {
      const { reservations, service } = build();
      reservations.findById.mockResolvedValue(reservation(R1, 'ACTIVE'));
      reservations.convert.mockResolvedValue(reservation(R1, 'CONVERTED'));

      await expect(service.sellReserved(R1, REFERENCE)).resolves.toEqual({ kind: 'SOLD' });
      expect(reservations.convert).toHaveBeenCalledWith(R1, null, REFERENCE);
    });

    it('treats an already CONVERTED reservation as sold, without selling again', async () => {
      const { reservations, service } = build();
      reservations.findById.mockResolvedValue(reservation(R1, 'CONVERTED'));

      await expect(service.sellReserved(R1, REFERENCE)).resolves.toEqual({ kind: 'SOLD' });
      expect(reservations.convert).not.toHaveBeenCalled();
    });

    it.each(['RELEASED', 'EXPIRED'] as const)(
      'reports a %s reservation as NOT_HELD and changes nothing',
      async (status) => {
        const { reservations, service } = build();
        reservations.findById.mockResolvedValue(reservation(R1, status));

        await expect(service.sellReserved(R1, REFERENCE)).resolves.toEqual({
          kind: 'NOT_HELD',
          status,
        });
        expect(reservations.convert).not.toHaveBeenCalled();
      },
    );

    it('reports a missing reservation as NOT_HELD', async () => {
      const { reservations, service } = build();
      reservations.findById.mockResolvedValue(null);

      await expect(service.sellReserved(R1, REFERENCE)).resolves.toEqual({
        kind: 'NOT_HELD',
        status: 'MISSING',
      });
    });

    it('counts a lost race to a concurrent seller as sold', async () => {
      const { reservations, service } = build();
      reservations.findById
        .mockResolvedValueOnce(reservation(R1, 'ACTIVE')) // looked ACTIVE...
        .mockResolvedValueOnce(reservation(R1, 'CONVERTED')); // ...the winner converted it
      reservations.convert.mockRejectedValue(new ReservationNotActiveError(R1, 'CONVERTED'));

      await expect(service.sellReserved(R1, REFERENCE)).resolves.toEqual({ kind: 'SOLD' });
    });

    it('reports a lost race to a concurrent release as NOT_HELD, not as a sale', async () => {
      const { reservations, service } = build();
      reservations.findById
        .mockResolvedValueOnce(reservation(R1, 'ACTIVE'))
        .mockResolvedValueOnce(reservation(R1, 'RELEASED'));
      reservations.convert.mockRejectedValue(new ReservationNotActiveError(R1, 'RELEASED'));

      await expect(service.sellReserved(R1, REFERENCE)).resolves.toEqual({
        kind: 'NOT_HELD',
        status: 'RELEASED',
      });
    });

    it.each([
      ['InsufficientStockError', new InsufficientStockError('on_hand_quantity', 0, -1)],
      ['InvalidReservationOperationError', new InvalidReservationOperationError('only 0 on hand')],
    ])('reports %s as SHORT with the reason', async (_name, error) => {
      const { reservations, service } = build();
      reservations.findById.mockResolvedValue(reservation(R1, 'ACTIVE'));
      reservations.convert.mockRejectedValue(error);

      await expect(service.sellReserved(R1, REFERENCE)).resolves.toEqual({
        kind: 'SHORT',
        reason: error.message,
      });
    });

    it('does not swallow an unexpected failure — the caller must see it and retry', async () => {
      const { reservations, service } = build();
      reservations.findById.mockResolvedValue(reservation(R1, 'ACTIVE'));
      reservations.convert.mockRejectedValue(new Error('connection terminated'));

      await expect(service.sellReserved(R1, REFERENCE)).rejects.toThrow('connection terminated');
    });
  });

  describe('acquireAndSell', () => {
    const input = {
      productSkuId: SKU,
      quantity: 2,
      sourceType: 'ORDER',
      sourceId: 'order-1',
      idempotencyKey: 'order__order-1__sku',
      reference: REFERENCE,
    };

    it('reserves under the deterministic key and sells', async () => {
      const { reservations, allocation, service } = build();
      reservations.findByIdempotencyKey.mockResolvedValue(null);
      allocation.allocate.mockResolvedValue({
        warehouseId: WAREHOUSE,
        locationId: LOCATION,
        explanation: [],
      });
      reservations.reserve.mockResolvedValue(reservation(R2, 'ACTIVE'));
      reservations.findById.mockResolvedValue(reservation(R2, 'ACTIVE'));
      reservations.convert.mockResolvedValue(reservation(R2, 'CONVERTED'));

      await expect(service.acquireAndSell(input)).resolves.toEqual({ kind: 'SOLD' });
      expect(reservations.reserve).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 2,
          sourceType: 'ORDER',
          sourceId: 'order-1',
          idempotencyKey: 'order__order-1__sku',
        }),
      );
    });

    it('is SHORT — and reserves nothing — when no warehouse has the units', async () => {
      const { reservations, allocation, service } = build();
      reservations.findByIdempotencyKey.mockResolvedValue(null);
      allocation.allocate.mockResolvedValue({
        warehouseId: null,
        locationId: null,
        explanation: [],
      });

      const outcome = await service.acquireAndSell(input);

      expect(outcome).toEqual({ kind: 'SHORT', reason: 'no warehouse has 2 unit(s) available' });
      expect(reservations.reserve).not.toHaveBeenCalled();
    });

    it('is SHORT when the units are taken between allocation and reservation', async () => {
      const { reservations, allocation, service } = build();
      reservations.findByIdempotencyKey.mockResolvedValue(null);
      allocation.allocate.mockResolvedValue({
        warehouseId: WAREHOUSE,
        locationId: LOCATION,
        explanation: [],
      });
      reservations.reserve.mockRejectedValue(
        new InsufficientStockError('available_quantity', 0, -1),
      );

      const outcome = await service.acquireAndSell(input);

      expect(outcome.kind).toBe('SHORT');
    });

    it('settles a reservation a previous attempt already made — without consulting live availability', async () => {
      const { reservations, allocation, service } = build();
      // The earlier attempt reserved AND sold: live availability is now 0, which
      // must not be mistaken for a shortfall.
      reservations.findByIdempotencyKey.mockResolvedValue(reservation(R2, 'CONVERTED'));

      await expect(service.acquireAndSell(input)).resolves.toEqual({ kind: 'SOLD' });
      expect(allocation.allocate).not.toHaveBeenCalled();
      expect(reservations.reserve).not.toHaveBeenCalled();
      expect(reservations.convert).not.toHaveBeenCalled();
    });

    it('finishes the sale when a previous attempt reserved but crashed before selling', async () => {
      const { reservations, allocation, service } = build();
      reservations.findByIdempotencyKey.mockResolvedValue(reservation(R2, 'ACTIVE'));
      reservations.findById.mockResolvedValue(reservation(R2, 'ACTIVE'));
      reservations.convert.mockResolvedValue(reservation(R2, 'CONVERTED'));

      await expect(service.acquireAndSell(input)).resolves.toEqual({ kind: 'SOLD' });
      expect(allocation.allocate).not.toHaveBeenCalled();
      expect(reservations.convert).toHaveBeenCalledTimes(1);
    });

    it('is SHORT when the order-scoped reservation was released by someone', async () => {
      const { reservations, service } = build();
      reservations.findByIdempotencyKey.mockResolvedValue(reservation(R2, 'RELEASED'));

      const outcome = await service.acquireAndSell(input);

      expect(outcome.kind).toBe('SHORT');
      expect(reservations.convert).not.toHaveBeenCalled();
    });
  });
});
