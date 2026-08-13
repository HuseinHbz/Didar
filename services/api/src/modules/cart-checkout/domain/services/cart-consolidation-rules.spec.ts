import { CartConsolidationRules } from './cart-consolidation-rules';

describe('CartConsolidationRules', () => {
  it('hashes null/undefined/empty configuration to the empty string', () => {
    expect(CartConsolidationRules.hashConfiguration(null)).toBe('');
    expect(CartConsolidationRules.hashConfiguration(undefined)).toBe('');
    expect(CartConsolidationRules.hashConfiguration({})).toBe('');
  });

  it('hashes the same configuration identically regardless of key order', () => {
    const a = CartConsolidationRules.hashConfiguration({
      lens: 'blue-light',
      coating: 'anti-glare',
    });
    const b = CartConsolidationRules.hashConfiguration({
      coating: 'anti-glare',
      lens: 'blue-light',
    });
    expect(a).toBe(b);
    expect(a).not.toBe('');
  });

  it('hashes different configurations differently', () => {
    const a = CartConsolidationRules.hashConfiguration({ lens: 'blue-light' });
    const b = CartConsolidationRules.hashConfiguration({ lens: 'progressive' });
    expect(a).not.toBe(b);
  });
});
