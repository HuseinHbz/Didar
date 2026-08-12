import { InsufficientStockError } from './available-quantity-calculator';
import { InvalidReservationOperationError, ReservationRules } from './reservation-rules';

const snapshot = (
  overrides: Partial<Parameters<typeof ReservationRules.assertCanReserve>[0]> = {},
) => ({
  onHandQuantity: 10,
  reservedQuantity: 2,
  inTransitQuantity: 0,
  damagedQuantity: 0,
  quarantinedQuantity: 0,
  blockedQuantity: 0,
  ...overrides,
});

describe('ReservationRules', () => {
  describe('assertCanReserve', () => {
    it('allows a reservation that keeps available >= 0', () => {
      expect(() => {
        ReservationRules.assertCanReserve(snapshot(), 5);
      }).not.toThrow();
    });

    it('allows reserving exactly down to zero available', () => {
      expect(() => {
        ReservationRules.assertCanReserve(snapshot(), 8);
      }).not.toThrow();
    });

    it('rejects a reservation that would push available negative', () => {
      expect(() => {
        ReservationRules.assertCanReserve(snapshot(), 9);
      }).toThrow(InsufficientStockError);
    });

    it('rejects a non-positive quantity', () => {
      expect(() => {
        ReservationRules.assertCanReserve(snapshot(), 0);
      }).toThrow(InvalidReservationOperationError);
      expect(() => {
        ReservationRules.assertCanReserve(snapshot(), -1);
      }).toThrow(InvalidReservationOperationError);
    });
  });

  describe('assertCanRelease', () => {
    it('allows releasing up to the currently reserved quantity', () => {
      expect(() => {
        ReservationRules.assertCanRelease(snapshot({ reservedQuantity: 5 }), 5);
      }).not.toThrow();
    });

    it('rejects releasing more than is reserved', () => {
      expect(() => {
        ReservationRules.assertCanRelease(snapshot({ reservedQuantity: 3 }), 4);
      }).toThrow(InvalidReservationOperationError);
    });

    it('rejects a non-positive quantity', () => {
      expect(() => {
        ReservationRules.assertCanRelease(snapshot(), 0);
      }).toThrow(InvalidReservationOperationError);
    });
  });

  describe('assertCanConvert', () => {
    it('allows converting when both reserved and on-hand cover the quantity', () => {
      expect(() => {
        ReservationRules.assertCanConvert(snapshot({ onHandQuantity: 10, reservedQuantity: 4 }), 4);
      }).not.toThrow();
    });

    it('rejects converting more than reserved', () => {
      expect(() => {
        ReservationRules.assertCanConvert(snapshot({ onHandQuantity: 10, reservedQuantity: 2 }), 3);
      }).toThrow(InvalidReservationOperationError);
    });

    it('rejects converting more than on-hand even if reserved covers it', () => {
      expect(() => {
        ReservationRules.assertCanConvert(snapshot({ onHandQuantity: 2, reservedQuantity: 5 }), 3);
      }).toThrow(InvalidReservationOperationError);
    });
  });
});
