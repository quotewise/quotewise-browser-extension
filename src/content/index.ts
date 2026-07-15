import { MessageType } from '../types';
import type { CapturedPostData, ExtensionMessage } from '../types';
import { debugLog } from './common';
import type { PlatformAdapter } from '../platforms/types';
import { isSameCaptureUrl } from '../platforms/capture';
import { createPlatformAdapters } from '../platforms/registry';
import { OverlayBar } from './ui/overlay-bar';

// Extend Window interface for our global state
declare global {
  interface Window {
    __qw_content_initialized?: boolean;
    __qw_orchestrator?: ContentOrchestrator;
  }
}

class ContentOrchestrator {
  private adapters: PlatformAdapter<CapturedPostData>[];
  private activeAdapter: PlatformAdapter<CapturedPostData> | null = null;
  private urlWatcher: number | null = null;
  private lastUrl = window.location.href;
  private overlay: OverlayBar | null = null;
  private messageListenerRegistered = false;

  constructor(adapters: PlatformAdapter<CapturedPostData>[]) {
    this.adapters = adapters;
  }

  start(): void {
    this.selectAdapter(true);
    this.listenForMessages();
    this.watchUrlChanges();
  }

  private listenForMessages(): void {
    if (this.messageListenerRegistered) return;
    this.messageListenerRegistered = true;

    chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
      debugLog(`ContentOrchestrator received message: ${message.type}`);

      if (message.type === MessageType.SHOW_OVERLAY) {
        this.toggleOverlay().then(visible => sendResponse({ success: true, visible })).catch(error => {
          console.error('Error toggling overlay', error);
          sendResponse({ success: false, error: error?.message || 'Failed to toggle overlay' });
        });
        return true;
      }

      if (message.type === MessageType.EXTRACT_TWEET_DATA) {
        this.extractLatestData(true).then((data) => {
          if (data) {
            sendResponse({ success: true, data });
          } else {
            sendResponse({ success: false, error: 'No post data available on this page.' });
          }
        }).catch(error => {
          console.error('Error extracting data', error);
          sendResponse({ success: false, error: error?.message || 'Failed to extract data' });
        });
        return true;
      }

      if (message.type === MessageType.EXTRACT_POST_DATA) {
        this.extractLatestData(true).then((data) => {
          if (data) {
            sendResponse({ success: true, data });
          } else {
            sendResponse({ success: false, error: 'No post data available on this page.' });
          }
        }).catch(error => {
          console.error('Error extracting data', error);
          sendResponse({ success: false, error: error?.message || 'Failed to extract data' });
        });
        return true;
      }

      const handler = this.activeAdapter?.handleMessage?.bind(this.activeAdapter);
      if (handler) {
        const result = handler(message, sendResponse);
        if (result instanceof Promise) {
          result.catch(error => {
            console.error('Adapter message handling failed', error);
            sendResponse({ success: false, error: 'Adapter failed' });
          });
          return true;
        }
        return result;
      }

      return false;
    });
  }

  private watchUrlChanges(): void {
    if (this.urlWatcher) return;

    this.urlWatcher = window.setInterval(() => {
      const nextUrl = window.location.href;
      if (nextUrl !== this.lastUrl) {
        this.selectAdapter(true);
        this.lastUrl = nextUrl;
        // Tell the background a client-side navigation happened so it can refresh icon/capture
        // state. On Safari this is the ONLY signal (no webNavigation.onHistoryStateUpdated); on
        // Chrome it's harmless — the background dedupes by URL (spec 002 T006).
        chrome.runtime.sendMessage({ type: MessageType.SPA_NAV, data: { url: nextUrl } }).catch(() => {
          // background asleep / not listening — icon refresh is best-effort
        });
      }
    }, 750);
  }

  private async selectAdapter(urlChanged: boolean = false): Promise<void> {
    const match = this.adapters.find(adapter => adapter.matches(window.location)) || null;

    if (!match) {
      await this.activeAdapter?.teardown();
      this.activeAdapter = null;
      this.overlay?.hide();
      return;
    }

    // Only restart if switching platforms OR if the permalink source changed.
    const samePlatform = this.activeAdapter?.id === match.id;
    const needsRestart = !samePlatform || (urlChanged && !isSameCaptureUrl(this.lastUrl, window.location.href));

    if (needsRestart) {
      await this.activeAdapter?.teardown();
      this.activeAdapter = match;
      debugLog(`Activating adapter: ${match.id}`);
      await this.activeAdapter.bootstrap();
      // Do not auto-show overlay; user triggers via action click
    }
  }

  private async showOverlay(forceRefresh = false): Promise<void> {
    if (!this.activeAdapter || typeof this.activeAdapter.getLatestData !== 'function') {
      throw new Error('No active platform adapter');
    }

    if (!this.overlay) {
      this.overlay = new OverlayBar(() => this.activeAdapter!.getLatestData!());
    }

    const data = await this.getDataWithRetry(forceRefresh ? 3 : 1);
    this.overlay.show(this.activeAdapter.id);
    this.overlay.render(data);
  }

  private async toggleOverlay(): Promise<boolean> {
    if (this.overlay?.isVisible()) {
      this.overlay.hide();
      return false;
    }

    await this.showOverlay();
    return true;
  }

  private async extractLatestData(forceRefresh = false): Promise<CapturedPostData | null> {
    if (!this.activeAdapter || typeof this.activeAdapter.getLatestData !== 'function') {
      await this.selectAdapter(true);
    }

    if (!this.activeAdapter || typeof this.activeAdapter.getLatestData !== 'function') {
      return null;
    }

    return this.getDataWithRetry(forceRefresh ? 3 : 1);
  }

  private async getDataWithRetry(retries: number): Promise<CapturedPostData | null> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt < retries) {
      try {
        const data = await this.activeAdapter!.getLatestData!();
        if (data) return data as CapturedPostData;
      } catch (error) {
        lastError = error;
      }
      attempt += 1;
      await new Promise(r => setTimeout(r, 300));
    }
    if (lastError) {
      throw lastError;
    }
    return null;
  }
}

// Guard against double initialization (can happen with programmatic injection)
if (window.__qw_content_initialized) {
  // Already initialized - just trigger re-bootstrap for potential new tweet
  debugLog('Content script already initialized, triggering re-bootstrap');
  window.__qw_orchestrator?.start();
} else {
  // First initialization
  window.__qw_content_initialized = true;
  const orchestrator = new ContentOrchestrator(createPlatformAdapters());
  window.__qw_orchestrator = orchestrator;
  orchestrator.start();
  debugLog('Content script initialized');
}
