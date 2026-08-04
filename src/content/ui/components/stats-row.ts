export interface CaptureStats {
  dupRttMs?: number;
  cacheHit?: boolean;
  origRttMs?: number;
  preMs?: number;
}

function timing(label: string, value: number | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${label} ${Math.round(value)}ms` : null;
}

export class StatsRow {
  constructor(private readonly container: HTMLElement) {}

  update(stats: CaptureStats): void {
    const fields = [
      timing('pre', stats.preMs),
      timing('orig', stats.origRttMs),
      timing('dup', stats.dupRttMs),
      typeof stats.cacheHit === 'boolean' ? `dup cache ${stats.cacheHit ? 'hit' : 'live'}` : null,
    ].filter((field): field is string => field !== null);

    this.container.textContent = fields.length ? `⚡ ${fields.join(' · ')}` : '';
    this.container.hidden = fields.length === 0;
  }

  clear(): void {
    this.container.textContent = '';
    this.container.hidden = true;
  }
}
