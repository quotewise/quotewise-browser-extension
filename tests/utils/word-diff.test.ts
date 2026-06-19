import { diffWords } from '../../src/utils/word-diff';

describe('diffWords', () => {
  it('returns all equal tokens for identical strings', () => {
    expect(diffWords('hello world', 'hello world')).toEqual([
      { value: 'hello ', type: 'equal' },
      { value: 'world', type: 'equal' },
    ]);
  });

  it('handles pure insertion', () => {
    expect(diffWords('hello world', 'hello brave world')).toEqual([
      { value: 'hello ', type: 'equal' },
      { value: 'brave ', type: 'added' },
      { value: 'world', type: 'equal' },
    ]);
  });

  it('handles pure deletion', () => {
    expect(diffWords('hello brave world', 'hello world')).toEqual([
      { value: 'hello ', type: 'equal' },
      { value: 'brave ', type: 'removed' },
      { value: 'world', type: 'equal' },
    ]);
  });

  it('handles substitution and reorder', () => {
    expect(diffWords('alpha beta gamma', 'alpha gamma beta')).toEqual([
      { value: 'alpha ', type: 'equal' },
      { value: 'beta ', type: 'removed' },
      { value: 'gamma ', type: 'equal' },
      { value: 'beta', type: 'added' },
    ]);
  });

  it('handles empty captured or on-record text', () => {
    expect(diffWords('', 'new text')).toEqual([
      { value: 'new ', type: 'added' },
      { value: 'text', type: 'added' },
    ]);
    expect(diffWords('old text', '')).toEqual([
      { value: 'old ', type: 'removed' },
      { value: 'text', type: 'removed' },
    ]);
  });

  it('handles unicode and emoji safely', () => {
    expect(diffWords('cafe 😊', 'café 😊')).toEqual([
      { value: 'cafe ', type: 'removed' },
      { value: 'café ', type: 'added' },
      { value: '😊', type: 'equal' },
    ]);
  });
});
