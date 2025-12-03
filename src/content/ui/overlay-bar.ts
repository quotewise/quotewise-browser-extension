import type { TwitterData } from '../../types';
import { MessageType } from '../../types';

type DataProvider = () => Promise<TwitterData | null>;

/**
 * Overlay bar UI for tweet capture
 * Design guardrails:
 * - Single-row layout: tweet text on the left, metadata chips right-aligned before controls.
 * - Chips order mirrors Twitter: handle, date/time, comments, retweets, likes, views, bookmarks.
 * - Preserve line breaks in text; allow up to ~8 lines with scroll if longer.
 * - Chips stay on one line when possible; allow horizontal scroll instead of wrapping mid-chip.
 * - Bar is shown on demand (toolbar click), hidden via close; auto-hides when leaving supported pages.
 */
export class OverlayBar {
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private hidden = false;
  private dataProvider: DataProvider;
  private currentPlatformLabel = 'Twitter';

  constructor(dataProvider: DataProvider) {
    this.dataProvider = dataProvider;
  }

  show(platformLabel: string): void {
    this.currentPlatformLabel = platformLabel;
    this.hidden = false;
    if (!this.root) {
      this.mount();
    }
    if (this.root) {
      this.root.setAttribute('aria-hidden', 'false');
    }
    if (this.shadow) {
      const bar = this.shadow.querySelector('.bar');
      bar?.setAttribute('aria-hidden', 'false');
    }
  }

  hide(): void {
    this.hidden = true;
    if (this.root) {
      this.root.setAttribute('aria-hidden', 'true');
    }
    if (this.shadow) {
      const bar = this.shadow.querySelector('.bar');
      bar?.setAttribute('aria-hidden', 'true');
    }
  }

  async refresh(): Promise<void> {
    if (!this.shadow) return;
    const data = await this.dataProvider();
    this.render(data);
  }

  private mount(): void {
    this.root = document.createElement('div');
    this.root.id = 'qw-overlay-bar-root';
    this.root.style.position = 'fixed';
    this.root.style.top = '0';
    this.root.style.left = '0';
    this.root.style.right = '0';
    this.root.style.zIndex = '2147483647';
    this.root.style.pointerEvents = 'none';
    document.documentElement.appendChild(this.root);

    this.shadow = this.root.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = this.buildBaseMarkup();

    this.wireInteractions();
  }

  private buildBaseMarkup(): string {
    return `
      <style>
        :host { all: initial; }
        .bar {
          box-sizing: border-box;
          position: relative;
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          background: #0f172a;
          color: #e2e8f0;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          line-height: 18px;
          pointer-events: auto;
          transform: translateY(0);
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        .bar[aria-hidden="true"] {
          transform: translateY(-100%);
          opacity: 0.6;
        }
        .section {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .left { flex: 0 0 auto; }
        .center {
          flex: 1 1 auto;
          overflow: hidden;
          display: flex;
          align-items: center;
          gap: 16px;
          min-width: 0;
        }
        .right { flex: 0 0 auto; gap: 6px; }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(255,255,255,0.1);
          color: #e2e8f0;
          font-weight: 600;
          white-space: nowrap;
        }
        .badge.protected { background: rgba(234,179,8,0.15); color: #facc15; }
        .text {
          min-width: 0;
          white-space: pre-line;
          max-height: calc(1.35em * 8);
          overflow-y: auto;
          overflow-x: hidden;
        }
        .meta-row {
          flex: 2 1 0%;
          display: flex;
          flex-wrap: nowrap;
          gap: 8px;
          font-size: 12px;
          color: #cbd5e1;
          justify-content: flex-end;
          min-width: 0;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 6px;
          border-radius: 6px;
          background: rgba(255,255,255,0.08);
          white-space: nowrap;
        }
        .chip .icon { opacity: 0.8; }
        button {
          border: none;
          border-radius: 6px;
          padding: 6px 10px;
          background: rgba(255,255,255,0.12);
          color: #e2e8f0;
          cursor: pointer;
          font-size: 12px;
          line-height: 16px;
        }
        button:hover { background: rgba(255,255,255,0.18); }
        button.primary { background: #2563eb; color: #fff; }
        button.primary:hover { background: #1d4ed8; }
        .toggle {
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.12);
          color: #e2e8f0;
        }
      </style>
      <div class="bar" aria-hidden="false">
        <div class="section left">
          <div class="badge" id="platform-badge">${this.currentPlatformLabel}</div>
          <div class="badge protected" id="protected-badge" style="display:none;">Protected</div>
        </div>
        <div class="section center">
          <div class="text" id="tweet-preview">Collecting tweet data…</div>
          <div class="meta-row" id="meta-row"></div>
        </div>
        <div class="section right">
          <button id="refresh-btn">Refresh</button>
          <button class="primary" id="capture-btn">Capture</button>
          <button class="toggle" id="close-btn" aria-label="Close bar">×</button>
        </div>
      </div>
    `;
  }

  render(data: TwitterData | null): void {
    if (!this.shadow) return;
    const previewEl = this.shadow.getElementById('tweet-preview');
    const protectedBadge = this.shadow.getElementById('protected-badge');
    const platformBadge = this.shadow.getElementById('platform-badge');
    const metaRow = this.shadow.getElementById('meta-row');
    if (platformBadge) {
      platformBadge.textContent = this.currentPlatformLabel;
    }

    if (!previewEl) return;
    if (!data) {
      previewEl.textContent = 'No tweet detected on this page.';
      if (protectedBadge) protectedBadge.setAttribute('style', 'display:none;');
      if (metaRow) metaRow.innerHTML = '';
      return;
    }

    const protectedText = data.isProtected || data.platform_data?.is_protected;
    if (protectedBadge) {
      protectedBadge.setAttribute('style', protectedText ? '' : 'display:none;');
    }

    const snippet = (data.text || '').trim();
    previewEl.textContent = snippet || 'Tweet text unavailable';

    if (metaRow) {
      metaRow.innerHTML = this.buildMetaChips(data);
    }
  }

  private buildMetaChips(data: TwitterData): string {
    const chips: string[] = [];

    if (data.author?.username) {
      chips.push(`<span class="chip"><span class="icon">@</span>${data.author.username}</span>`);
    }

    if (data.date) {
      const date = new Date(data.date);
      const dateText = isNaN(date.getTime()) ? data.date : date.toLocaleString();
      chips.push(`<span class="chip"><span class="icon">🗓</span>${dateText}</span>`);
    }

    const metricChip = (icon: string, val?: number) =>
      typeof val === 'number' && !isNaN(val) ? `<span class="chip"><span class="icon">${icon}</span>${val}</span>` : '';

    chips.push(metricChip('💬', data.replies));
    chips.push(metricChip('🔁', data.retweets));
    chips.push(metricChip('❤️', data.likes));
    chips.push(metricChip('👁', data.views));
    chips.push(metricChip('🔖', data.bookmarks));

    return chips.filter(Boolean).join('');
  }

  private wireInteractions(): void {
    if (!this.shadow) return;
    const refreshBtn = this.shadow.getElementById('refresh-btn');
    const captureBtn = this.shadow.getElementById('capture-btn');
    const closeBtn = this.shadow.getElementById('close-btn');
    const bar = this.shadow.querySelector('.bar');

    refreshBtn?.addEventListener('click', () => this.refresh());
    captureBtn?.addEventListener('click', () => this.refresh());
    closeBtn?.addEventListener('click', () => {
      this.hide();
      if (bar) {
        bar.setAttribute('aria-hidden', 'true');
      }
    });
  }
}
