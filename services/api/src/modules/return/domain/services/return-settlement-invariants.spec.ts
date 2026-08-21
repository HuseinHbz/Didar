import {
  MissingImmutableSnapshotError,
  NonPositiveRestockQuantityError,
  ReturnSettlementInvariants,
} from './return-settlement-invariants';

describe('ReturnSettlementInvariants', () => {
  describe('assertSnapshotPresent', () => {
    it('returns the value unchanged when present', () => {
      expect(
        ReturnSettlementInvariants.assertSnapshotPresent('sku-1', 'item-1', 'productSkuId'),
      ).toBe('sku-1');
      expect(ReturnSettlementInvariants.assertSnapshotPresent(0, 'item-1', 'quantity')).toBe(0);
    });

    it('throws MissingImmutableSnapshotError for null', () => {
      expect(() => {
        ReturnSettlementInvariants.assertSnapshotPresent(null, 'item-1', 'productSkuId');
      }).toThrow(MissingImmutableSnapshotError);
    });

    it('throws MissingImmutableSnapshotError for undefined', () => {
      expect(() => {
        ReturnSettlementInvariants.assertSnapshotPresent(undefined, 'item-1', 'productSkuId');
      }).toThrow(MissingImmutableSnapshotError);
    });

    it('includes both the return item id and the missing field name in the message', () => {
      try {
        ReturnSettlementInvariants.assertSnapshotPresent(null, 'item-42', 'productSkuId');
        fail('expected assertSnapshotPresent to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(MissingImmutableSnapshotError);
        expect((error as Error).message).toContain('item-42');
        expect((error as Error).message).toContain('productSkuId');
      }
    });
  });

  describe('assertPositiveRestockQuantity', () => {
    it('does not throw for a positive quantity', () => {
      expect(() => {
        ReturnSettlementInvariants.assertPositiveRestockQuantity('item-1', 1);
      }).not.toThrow();
      expect(() => {
        ReturnSettlementInvariants.assertPositiveRestockQuantity('item-1', 100);
      }).not.toThrow();
    });

    it('throws NonPositiveRestockQuantityError for zero', () => {
      expect(() => {
        ReturnSettlementInvariants.assertPositiveRestockQuantity('item-1', 0);
      }).toThrow(NonPositiveRestockQuantityError);
    });

    it('throws NonPositiveRestockQuantityError for a negative quantity', () => {
      expect(() => {
        ReturnSettlementInvariants.assertPositiveRestockQuantity('item-1', -5);
      }).toThrow(NonPositiveRestockQuantityError);
    });

    it('includes the return item id and quantity in the message', () => {
      try {
        ReturnSettlementInvariants.assertPositiveRestockQuantity('item-99', -3);
        fail('expected assertPositiveRestockQuantity to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(NonPositiveRestockQuantityError);
        expect((error as Error).message).toContain('item-99');
        expect((error as Error).message).toContain('-3');
      }
    });
  });
});
