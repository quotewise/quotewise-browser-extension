import { MessageType } from '../types';
import type { ExtensionMessage } from '../types';
import { debugLog } from './common';
import type { PlatformAdapter } from '../platforms/types';
import { TwitterAdapter } from '../platforms/twitter/adapter';

class ContentOrchestrator {
  private adapters: PlatformAdapter[];
  private activeAdapter: PlatformAdapter | null = null;
  private urlWatcher: number | null = null;
  private lastUrl = window.location.href;

  constructor(adapters: PlatformAdapter[]) {
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

      if (message.type === MessageType.EXTRACT_TWEET_DATA) {
        sendResponse({ success: false, error: 'No active platform adapter for this page.' });
        return true;
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

  private async selectAdapter(forceRestart: boolean = false): Promise<void> {
    const match = this.adapters.find(adapter => adapter.matches(window.location)) || null;

    if (!match) {
      await this.activeAdapter?.teardown();
      this.activeAdapter = null;
      return;
    }

    const switched = forceRestart || !this.activeAdapter || this.activeAdapter.id !== match.id;
    if (switched) {
      await this.activeAdapter?.teardown();
      this.activeAdapter = match;
      debugLog(`Activating adapter: ${match.id}`);
      await this.activeAdapter.bootstrap();
    }
  }
}

const orchestrator = new ContentOrchestrator([
  new TwitterAdapter()
]);

orchestrator.start();
