import {
  OrderExceptionPolicy,
  OrderHasOpenExceptionError,
  StockStillShortError,
} from './order-exception-policy';

describe('OrderExceptionPolicy', () => {
  describe('assertApprovable', () => {
    it('allows an order with no exceptions', () => {
      expect(() => {
        OrderExceptionPolicy.assertApprovable('o1', []);
      }).not.toThrow();
    });

    it('allows an order whose exceptions are all resolved', () => {
      expect(() => {
        OrderExceptionPolicy.assertApprovable('o1', [
          { id: 'e1', type: 'STOCK_SHORTFALL', status: 'RESOLVED' },
        ]);
      }).not.toThrow();
    });

    it('refuses an order with an open exception and names it', () => {
      let thrown: unknown;
      try {
        OrderExceptionPolicy.assertApprovable('o1', [
          { id: 'e1', type: 'STOCK_SHORTFALL', status: 'RESOLVED' },
          { id: 'e2', type: 'STOCK_SHORTFALL', status: 'OPEN' },
        ]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(OrderHasOpenExceptionError);
      const error = thrown as OrderHasOpenExceptionError;
      expect(error.openExceptions).toEqual([{ id: 'e2', type: 'STOCK_SHORTFALL' }]);
      // The API surfaces this message to the operator: it must say "exception".
      expect(error.message).toContain('exception');
      expect(error.message).toContain('o1');
    });

    it('pluralises sensibly for several open exceptions', () => {
      const run = () => {
        OrderExceptionPolicy.assertApprovable('o1', [
          { id: 'e1', type: 'STOCK_SHORTFALL', status: 'OPEN' },
          { id: 'e2', type: 'STOCK_SHORTFALL', status: 'OPEN' },
        ]);
      };
      expect(run).toThrow(/2 open exception\(s\)/);
      expect(run).toThrow(/resolve them/);
    });
  });

  describe('stockShortfallKey', () => {
    it('is deterministic per (order, sku) so racing callers collapse onto one row', () => {
      expect(OrderExceptionPolicy.stockShortfallKey('o1', 's1')).toBe(
        OrderExceptionPolicy.stockShortfallKey('o1', 's1'),
      );
      expect(OrderExceptionPolicy.stockShortfallKey('o1', 's1')).not.toBe(
        OrderExceptionPolicy.stockShortfallKey('o1', 's2'),
      );
      expect(OrderExceptionPolicy.stockShortfallKey('o1', 's1')).not.toBe(
        OrderExceptionPolicy.stockShortfallKey('o2', 's1'),
      );
    });
  });

  describe('StockStillShortError', () => {
    it('carries the exception id and the reason', () => {
      const error = new StockStillShortError('e1', 'no warehouse has 2 unit(s) available');
      expect(error.exceptionId).toBe('e1');
      expect(error.message).toContain('e1');
      expect(error.message).toContain('no warehouse has 2 unit(s) available');
    });
  });
});
