export interface CaptureStats {
  dupRttMs?: number;
  srvMs?: number;
  cacheHit?: boolean;
  origRttMs?: number;
  preMs?: number;
}

function formatMs(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}ms` : '—';
}

export class StatsRow {
  constructor(private readonly container: HTMLElement) {}

  update(stats: CaptureStats): void {
    const cache = typeof stats.cacheHit === 'boolean' ? (stats.cacheHit ? 'hit' : 'live') : '—';
    this.container.textContent = `⚡ dup ${formatMs(stats.dupRttMs)} · srv ${formatMs(stats.srvMs)} · ${cache} · orig ${formatMs(stats.origRttMs)} · pre ${formatMs(stats.preMs)}`;
    this.container.hidden = false;
  }

  clear(): void {
    this.container.textContent = '';
    this.container.hidden = true;
  }
}
