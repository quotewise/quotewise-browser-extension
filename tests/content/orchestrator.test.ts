/**
 * @jest-environment-options {"url": "https://x.com/alice/status/123"}
 *
 * Behavioral tests for ContentOrchestrator — the code that survives a user
 * cycling between posts, mashing the toolbar button, and re-injecting the
 * content script. Driven through the real public surface (start() + the
 * registered runtime message listener + the 750ms URL-watch poll), with fake
 * adapters and an injected fake overlay so the assertions are about the
 * orchestrator's behavior, not adapter DOM extraction or Shadow-DOM internals.
 */
import { MessageType } from '../../src/types';
import type { CapturedPostData } from '../../src/types';
import type { PlatformAdapter } from '../../src/platforms/types';
import { ContentOrchestrator, type OverlayFactory } from '../../src/content/orchestrator';

const BASE_URL = '/alice/status/123';

const settle = () => jest.advanceTimersByTimeAsync(400);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (message: any, sender: any, sendResponse: any) => unknown;

function registeredListener(): Listener {
  const mock = chrome.runtime.onMessage.addListener as jest.Mock;
  return mock.mock.calls[0][0] as Listener;
}

function makeAdapter(overrides: Partial<PlatformAdapter<CapturedPostData>> = {}): PlatformAdapter<CapturedPostData> {
  return {
    id: 'twitter',
    matches: jest.fn(() => true),
    bootstrap: jest.fn().mockResolvedValue(undefined),
    teardown: jest.fn().mockResolvedValue(undefined),
    getLatestData: jest.fn().mockResolvedValue({ text: 'a quote' } as CapturedPostData),
    ...overrides,
  };
}

function makeFakeOverlay() {
  let visible = false;
  return {
    show: jest.fn(() => { visible = true; }),
    hide: jest.fn(() => { visible = false; }),
    isVisible: jest.fn(() => visible),
    render: jest.fn(),
  };
}

function overlayFactoryFor(overlay: ReturnType<typeof makeFakeOverlay>): OverlayFactory {
  return (() => overlay) as unknown as OverlayFactory;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (chrome.runtime.sendMessage as jest.Mock).mockResolvedValue(undefined);
  // Reset the SPA URL to the canonical permalink before each test / construction.
  window.history.pushState({}, '', BASE_URL);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ContentOrchestrator — SPA navigation / cycling', () => {
  it('restarts the adapter and notifies the background when cycling to a different post', async () => {
    const adapter = makeAdapter();
    const orch = new ContentOrchestrator([adapter]);
    orch.start();
    await settle();
    expect(adapter.bootstrap).toHaveBeenCalledTimes(1);
    expect(adapter.teardown).not.toHaveBeenCalled();

    window.history.pushState({}, '', '/bob/status/456');
    await jest.advanceTimersByTimeAsync(750);

    expect(adapter.teardown).toHaveBeenCalledTimes(1);
    expect(adapter.bootstrap).toHaveBeenCalledTimes(2);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.SPA_NAV,
        data: { url: expect.stringContaining('/bob/status/456') },
      }),
    );
  });

  it('does NOT restart the adapter when the same post gains tracking params', async () => {
    const adapter = makeAdapter();
    const orch = new ContentOrchestrator([adapter]);
    orch.start();
    await settle();
    expect(adapter.bootstrap).toHaveBeenCalledTimes(1);

    // Same post 123, just X's ?s= share junk appended — must not thrash the adapter.
    window.history.pushState({}, '', '/alice/status/123?s=20&t=abc');
    await jest.advanceTimersByTimeAsync(750);

    expect(adapter.teardown).not.toHaveBeenCalled();
    expect(adapter.bootstrap).toHaveBeenCalledTimes(1);
    // The background is still notified so it can refresh icon state (best-effort).
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SPA_NAV }),
    );
  });

  it('tears down the adapter when the user navigates to an unsupported page', async () => {
    const adapter = makeAdapter({
      matches: jest.fn(() => window.location.pathname.includes('/status/')),
    });
    const orch = new ContentOrchestrator([adapter]);
    orch.start();
    await settle();
    expect(adapter.bootstrap).toHaveBeenCalledTimes(1);

    window.history.pushState({}, '', '/home');
    await jest.advanceTimersByTimeAsync(750);

    expect(adapter.teardown).toHaveBeenCalledTimes(1);

    // Adapter is no longer active: extraction now reports no data.
    const sendResponse = jest.fn();
    registeredListener()({ type: MessageType.EXTRACT_POST_DATA }, {}, sendResponse);
    await jest.advanceTimersByTimeAsync(1500);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'No post data available on this page.',
    });
  });
});

describe('ContentOrchestrator — toolbar toggle (clicking the button repeatedly)', () => {
  it('opens on the first SHOW_OVERLAY and closes on the second', async () => {
    const overlay = makeFakeOverlay();
    const orch = new ContentOrchestrator([makeAdapter()], overlayFactoryFor(overlay));
    orch.start();
    await settle();
    const listener = registeredListener();

    const resp1 = jest.fn();
    expect(listener({ type: MessageType.SHOW_OVERLAY }, {}, resp1)).toBe(true);
    await settle();
    expect(overlay.show).toHaveBeenCalledTimes(1);
    expect(overlay.hide).not.toHaveBeenCalled();
    expect(resp1).toHaveBeenCalledWith({ success: true, visible: true });

    const resp2 = jest.fn();
    listener({ type: MessageType.SHOW_OVERLAY }, {}, resp2);
    await settle();
    expect(overlay.hide).toHaveBeenCalledTimes(1);
    expect(resp2).toHaveBeenCalledWith({ success: true, visible: false });
  });

  it('responds with an error (does not crash or half-open) when clicked on a non-permalink page', async () => {
    // On a supported host but a non-permalink page (e.g. x.com/home) no adapter is active.
    const overlay = makeFakeOverlay();
    const adapter = makeAdapter({ matches: jest.fn(() => false) });
    const orch = new ContentOrchestrator([adapter], overlayFactoryFor(overlay));
    orch.start();
    await settle();

    const sendResponse = jest.fn();
    registeredListener()({ type: MessageType.SHOW_OVERLAY }, {}, sendResponse);
    await settle();

    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'No active platform adapter' });
    expect(overlay.show).not.toHaveBeenCalled();
  });
});

describe('ContentOrchestrator — EXTRACT_POST_DATA', () => {
  it('returns extracted data without opening the overlay', async () => {
    const overlay = makeFakeOverlay();
    const orch = new ContentOrchestrator([makeAdapter()], overlayFactoryFor(overlay));
    orch.start();
    await settle();

    const sendResponse = jest.fn();
    registeredListener()({ type: MessageType.EXTRACT_POST_DATA }, {}, sendResponse);
    await settle();

    expect(sendResponse).toHaveBeenCalledWith({ success: true, data: { text: 'a quote' } });
    expect(overlay.show).not.toHaveBeenCalled();
  });

  it('reports an error when the adapter yields no data after retries', async () => {
    const adapter = makeAdapter({ getLatestData: jest.fn().mockResolvedValue(null) });
    const orch = new ContentOrchestrator([adapter]);
    orch.start();
    await settle();

    const sendResponse = jest.fn();
    registeredListener()({ type: MessageType.EXTRACT_POST_DATA }, {}, sendResponse);
    await jest.advanceTimersByTimeAsync(1500);

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'No post data available on this page.',
    });
  });
});

describe('ContentOrchestrator — content-script re-injection', () => {
  it('start() twice does not duplicate the message listener or the URL-watch timer', async () => {
    const adapter = makeAdapter();
    const orch = new ContentOrchestrator([adapter]);

    orch.start();
    await settle();
    orch.start(); // re-injection re-runs start()
    await settle();

    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    // Exactly one recurring interval (the 750ms URL watcher); no duplicate polling.
    expect(jest.getTimerCount()).toBe(1);
    // No spurious re-bootstrap when the URL hasn't changed.
    expect(adapter.bootstrap).toHaveBeenCalledTimes(1);
  });
});
