import { StatsRow } from '../../../../src/content/ui/components/stats-row';

describe('StatsRow', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.hidden = true;
  });

  it('renders measured stats in pipeline order with a labeled cache state', () => {
    const row = new StatsRow(container);

    row.update({
      dupRttMs: 412,
      cacheHit: false,
      origRttMs: 210,
      preMs: 780,
    });

    expect(container.textContent).toBe('⚡ pre 780ms · orig 210ms · dup 412ms · dup cache live');
    expect(container.hidden).toBe(false);
  });

  it('omits unmeasured stats and labels cache hits', () => {
    const row = new StatsRow(container);

    row.update({ cacheHit: true });

    expect(container.textContent).toBe('⚡ dup cache hit');
    expect(container.hidden).toBe(false);
  });

  it('stays hidden until a stat is measured and clears the row', () => {
    const row = new StatsRow(container);

    row.update({});
    expect(container.textContent).toBe('');
    expect(container.hidden).toBe(true);

    row.clear();
    expect(container.textContent).toBe('');
    expect(container.hidden).toBe(true);
  });
});
