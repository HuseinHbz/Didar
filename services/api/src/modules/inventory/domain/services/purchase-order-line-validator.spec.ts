import {
  InvalidPurchaseOrderLineError,
  PurchaseOrderLineValidator,
} from './purchase-order-line-validator';

const SKU_A = '11111111-1111-1111-1111-111111111111';
const SKU_B = '22222222-2222-2222-2222-222222222222';

describe('PurchaseOrderLineValidator', () => {
  describe('assertValid (create)', () => {
    it('accepts a well-formed, multi-line order', () => {
      expect(() => {
        PurchaseOrderLineValidator.assertValid([
          { productSkuId: SKU_A, orderedQuantity: 10, unitCost: 500_000n },
          { productSkuId: SKU_B, orderedQuantity: 5, unitCost: 0n },
        ]);
      }).not.toThrow();
    });

    it('rejects an empty line list', () => {
      expect(() => {
        PurchaseOrderLineValidator.assertValid([]);
      }).toThrow(InvalidPurchaseOrderLineError);
    });

    it('rejects a zero or negative ordered quantity', () => {
      for (const orderedQuantity of [0, -5]) {
        expect(() => {
          PurchaseOrderLineValidator.assertValid([
            { productSkuId: SKU_A, orderedQuantity, unitCost: 100n },
          ]);
        }).toThrow(InvalidPurchaseOrderLineError);
      }
    });

    it('rejects a negative unit cost', () => {
      expect(() => {
        PurchaseOrderLineValidator.assertValid([
          { productSkuId: SKU_A, orderedQuantity: 1, unitCost: -1n },
        ]);
      }).toThrow(InvalidPurchaseOrderLineError);
    });

    it('rejects a duplicate SKU across two lines', () => {
      expect(() => {
        PurchaseOrderLineValidator.assertValid([
          { productSkuId: SKU_A, orderedQuantity: 1, unitCost: 100n },
          { productSkuId: SKU_A, orderedQuantity: 2, unitCost: 200n },
        ]);
      }).toThrow(InvalidPurchaseOrderLineError);
    });
  });

  describe('assertValidReceipt', () => {
    it('accepts a receipt within the outstanding quantity', () => {
      expect(() => {
        PurchaseOrderLineValidator.assertValidReceipt(5, 10, SKU_A);
      }).not.toThrow();
      expect(() => {
        PurchaseOrderLineValidator.assertValidReceipt(10, 10, SKU_A);
      }).not.toThrow();
    });

    it('rejects a zero or negative received quantity', () => {
      for (const receivedQuantity of [0, -3]) {
        expect(() => {
          PurchaseOrderLineValidator.assertValidReceipt(receivedQuantity, 10, SKU_A);
        }).toThrow(InvalidPurchaseOrderLineError);
      }
    });

    it('rejects receiving more than what is outstanding', () => {
      expect(() => {
        PurchaseOrderLineValidator.assertValidReceipt(11, 10, SKU_A);
      }).toThrow(InvalidPurchaseOrderLineError);
    });
  });
});
