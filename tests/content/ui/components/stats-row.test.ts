import { StatsRow } from '../../../../src/content/ui/components/stats-row';

describe('StatsRow', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.hidden = true;
  });

  it('renders the complete performance line', () => {
    const row = new StatsRow(container);

    row.update({
      dupRttMs: 412,
      srvMs: 96,
      cacheHit: false,
      origRttMs: 210,
      preMs: 780,
    });

    expect(container.textContent).toBe('⚡ dup 412ms · srv 96ms · live · orig 210ms · pre 780ms');
    expect(container.hidden).toBe(false);
  });

  it('renders missing values and cache hits', () => {
    const row = new StatsRow(container);

    row.update({ cacheHit: true });

    expect(container.textContent).toBe('⚡ dup — · srv — · hit · orig — · pre —');
  });

  it('renders an unknown cache state and clears the row', () => {
    const row = new StatsRow(container);

    row.update({});
    expect(container.textContent).toBe('⚡ dup — · srv — · — · orig — · pre —');

    row.clear();
    expect(container.textContent).toBe('');
    expect(container.hidden).toBe(true);
  });
});
