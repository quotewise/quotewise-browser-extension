import { debugLog } from './common';
import { createPlatformAdapters } from '../platforms/registry';
import { ContentOrchestrator } from './orchestrator';

// Extend Window interface for our global state
declare global {
  interface Window {
    __qw_content_initialized?: boolean;
    __qw_orchestrator?: ContentOrchestrator;
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
