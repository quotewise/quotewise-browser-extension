import { MessageType } from '../types';
import type { ExtensionMessage, TwitterData } from '../types';
import { debugLog } from './common';
import type { PlatformAdapter } from '../platforms/types';
import { TwitterAdapter } from '../platforms/twitter/adapter';
import { OverlayBar } from './ui/overlay-bar';

class ContentOrchestrator {
  private adapters: PlatformAdapter<TwitterData>[];
  private activeAdapter: PlatformAdapter<TwitterData> | null = null;
  private urlWatcher: number | null = null;
  private lastUrl = window.location.href;
  private overlay: OverlayBar | null = null;

  constructor(adapters: PlatformAdapter<TwitterData>[]) {
    this.adapters = adapters;
  }

  start(): void {
    this.selectAdapter(true);
    this.listenForMessages();
    this.watchUrlChanges();
  }

  private listenForMessages(): void {
    chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
      debugLog(`ContentOrchestrator received message: ${message.type}`);

      if (message.type === MessageType.SHOW_OVERLAY) {
        this.showOverlay().then(() => sendResponse({ success: true })).catch(error => {
          console.error('Error showing overlay', error);
          sendResponse({ success: false, error: error?.message || 'Failed to show overlay' });
        });
        return true;
      }

      if (message.type === MessageType.EXTRACT_TWEET_DATA) {
        this.showOverlay(true).then(() => sendResponse({ success: true })).catch(error => {
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
      if (window.location.href !== this.lastUrl) {
        this.lastUrl = window.location.href;
        this.selectAdapter(true);
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

    // Only restart if switching platforms OR if tweet ID actually changed
    const samePlatform = this.activeAdapter?.id === match.id;
    const needsRestart = !samePlatform || (urlChanged && this.tweetIdChanged());

    if (needsRestart) {
      await this.activeAdapter?.teardown();
      this.activeAdapter = match;
      debugLog(`Activating adapter: ${match.id}`);
      await this.activeAdapter.bootstrap();
      // Do not auto-show overlay; user triggers via action click
    }
  }

  private tweetIdChanged(): boolean {
    const currentId = this.extractTweetId(window.location.href);
    const lastId = this.extractTweetId(this.lastUrl);
    return currentId !== lastId;
  }

  private extractTweetId(url: string): string | null {
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : null;
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

  private async getDataWithRetry(retries: number): Promise<TwitterData | null> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt < retries) {
      try {
        const data = await this.activeAdapter!.getLatestData!();
        if (data) return data as TwitterData;
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

const orchestrator = new ContentOrchestrator([
  new TwitterAdapter()
]);

orchestrator.start();
