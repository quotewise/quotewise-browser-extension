import { normalizeQuoteText } from '../../src/utils/quote-text';

describe('normalizeQuoteText', () => {
  it('normalizes Unicode and whitespace while preserving case', () => {
    expect(normalizeQuoteText('  A\n B ')).toBe('A B');
    expect(normalizeQuoteText('  A\n B ')).toBe(normalizeQuoteText('A B'));
    expect(normalizeQuoteText('\u212b')).toBe(normalizeQuoteText('\u00c5'));
    expect(normalizeQuoteText('Case')).not.toBe(normalizeQuoteText('case'));
  });
});
