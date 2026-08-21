import { describe, expect, it } from 'vitest';

import { formatRial } from './money';

describe('formatRial', () => {
  it('formats a real rial-integer string as Persian-locale Toman via Money.formatToman()', () => {
    // 58,000,000 Rial = 5,800,000 Toman
    expect(formatRial('58000000')).toBe('۵٬۸۰۰٬۰۰۰ تومان');
  });

  it('formats zero correctly', () => {
    expect(formatRial('0')).toBe('۰ تومان');
  });

  it('returns an em dash for null/undefined rather than throwing or showing "NaN"', () => {
    expect(formatRial(null)).toBe('—');
    expect(formatRial(undefined)).toBe('—');
  });

  it('falls back to the raw value for a non-numeric string instead of throwing', () => {
    expect(formatRial('not-a-number')).toBe('not-a-number');
  });
});
