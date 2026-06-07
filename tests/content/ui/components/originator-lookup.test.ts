import { OriginatorLookup } from '../../../../src/content/ui/components/originator-lookup';
import type { OriginatorSearchResult } from '../../../../src/types/api';

describe('OriginatorLookup', () => {
  let container: HTMLElement;
  let sendMessage: jest.Mock;
  let lookup: OriginatorLookup;

  const mockOriginator: OriginatorSearchResult = {
    id: 42,
    unique_id: 'albert-einstein',
    full_name: 'Albert Einstein',
    sort_name_display: 'Einstein, Albert',
    confidence: 10,
  };

  beforeEach(() => {
    container = document.createElement('div');
    sendMessage = jest.fn();
    lookup = new OriginatorLookup(container, sendMessage);
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({});
  });

  it('renders found originator with name and handle', async () => {
    sendMessage.mockResolvedValue({
      success: true,
      found: true,
      originator: mockOriginator,
    });

    const outcome = await lookup.lookup('einstein');

    expect(outcome.status).toBe('found');
    expect(outcome.originator).toBe(mockOriginator);
    expect(container.innerHTML).toContain('Albert Einstein');
    expect(container.innerHTML).toContain('@einstein');
    expect(container.innerHTML).toContain('badge success');
    expect(container.innerHTML).not.toContain('(cached)');
  });

  it('returns cached result without API call on second lookup', async () => {
    sendMessage.mockResolvedValue({
      success: true,
      found: true,
      originator: mockOriginator,
    });

    await lookup.lookup('einstein');
    sendMessage.mockClear();

    const outcome = await lookup.lookup('einstein');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(outcome.status).toBe('found');
    expect(outcome.originator).toBe(mockOriginator);
    expect(container.innerHTML).toContain('(cached)');
  });

  it('renders not-found with create link', async () => {
    sendMessage.mockResolvedValue({
      success: true,
      found: false,
      create_url: 'https://quotewise.io/create?handle=nobody',
    });

    const outcome = await lookup.lookup('nobody', 'https://x.com/nobody/status/123');

    expect(outcome.status).toBe('not_found');
    expect(outcome.createUrl).toBe('https://quotewise.io/create?handle=nobody');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'LOOKUP_ORIGINATOR_BY_HANDLE',
      data: {
        handle: 'nobody',
        platform: 'twitter',
        source_url: 'https://x.com/nobody/status/123',
      },
    });
    expect(container.innerHTML).toContain('badge warning');
    expect(container.innerHTML).toContain('>@</span>');
    expect(container.innerHTML).toContain('No originator found for @nobody');
    expect(container.innerHTML).toContain('Create on Quotewise');
    expect(container.innerHTML).toContain('href="https://quotewise.io/create?handle=nobody"');
  });

  it('renders a fallback create link when API not-found omits create_url', async () => {
    sendMessage.mockResolvedValue({
      success: true,
      found: false,
    });

    const outcome = await lookup.lookup('EricJorgenson', 'https://x.com/EricJorgenson/status/123');

    expect(outcome.status).toBe('not_found');
    expect(outcome.createUrl).toBe(
      'http://quotewise.test:8000/originators/add/?suggested_handle=EricJorgenson&platform=twitter'
    );
    expect(container.innerHTML).toContain('Create on Quotewise');
    expect(container.innerHTML).toContain(
      'href="http://quotewise.test:8000/originators/add/?suggested_handle=EricJorgenson&amp;platform=twitter"'
    );
  });

  it('renders error state on API failure', async () => {
    sendMessage.mockRejectedValue(new Error('Network timeout'));

    const outcome = await lookup.lookup('someone');

    expect(outcome.status).toBe('error');
    expect(outcome.errorMessage).toBe('Network timeout');
    expect(container.innerHTML).toContain('badge error');
    expect(container.innerHTML).toContain('Lookup failed: Network timeout');
  });

  it('renders error when API returns failure', async () => {
    sendMessage.mockResolvedValue({
      success: false,
      error: 'Server error',
    });

    const outcome = await lookup.lookup('someone');

    expect(outcome.status).toBe('error');
    expect(outcome.errorMessage).toBe('Server error');
  });

  it('uses preloaded data when fresh', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedOriginator: {
        handle: 'einstein',
        originator: mockOriginator,
        timestamp: Date.now() - 5000, // 5s ago, fresh
      },
    });

    const outcome = await lookup.lookup('Einstein');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(outcome.status).toBe('found');
    expect(outcome.originator).toBe(mockOriginator);
    expect(container.innerHTML).toContain('Albert Einstein');
  });

  it('normalizes a preloaded originator slug for submit', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedOriginator: {
        handle: 'einstein',
        originator: {
          id: 42,
          slug: 'albert-einstein',
          full_name: 'Albert Einstein',
          confidence: 1,
        },
        timestamp: Date.now() - 5000,
      },
    });

    const outcome = await lookup.lookup('Einstein');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(outcome.status).toBe('found');
    expect(outcome.originator?.unique_id).toBe('albert-einstein');
    expect(container.innerHTML).toContain('Albert Einstein');
  });

  it('falls back to API when a preloaded originator has no slug', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedOriginator: {
        handle: 'einstein',
        originator: {
          id: 42,
          full_name: 'Albert Einstein',
          sort_name_display: 'Einstein, Albert',
          confidence: 1,
        },
        timestamp: Date.now() - 5000,
      },
    });
    sendMessage.mockResolvedValue({
      success: true,
      found: true,
      originator: mockOriginator,
    });

    const outcome = await lookup.lookup('Einstein');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'LOOKUP_ORIGINATOR_BY_HANDLE',
      data: {
        handle: 'Einstein',
        platform: 'twitter',
        source_url: undefined,
      },
    });
    expect(outcome.status).toBe('found');
    expect(outcome.originator?.unique_id).toBe('albert-einstein');
  });

  it('falls back to API when preloaded data is stale', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedOriginator: {
        handle: 'einstein',
        originator: mockOriginator,
        timestamp: Date.now() - 120000, // 2min ago, stale
      },
    });

    sendMessage.mockResolvedValue({
      success: true,
      found: true,
      originator: mockOriginator,
    });

    const outcome = await lookup.lookup('Einstein');

    expect(sendMessage).toHaveBeenCalled();
    expect(outcome.status).toBe('found');
  });

  it('normalizes an API originator slug for submit', async () => {
    sendMessage.mockResolvedValue({
      success: true,
      found: true,
      originator: {
        id: 42,
        slug: 'albert-einstein',
        full_name: 'Albert Einstein',
        confidence: 1,
      },
    });

    const outcome = await lookup.lookup('einstein');

    expect(outcome.status).toBe('found');
    expect(outcome.originator?.unique_id).toBe('albert-einstein');
    expect(container.innerHTML).toContain('Albert Einstein');
  });

  it('does not cache not-found results (re-checks on next lookup)', async () => {
    sendMessage.mockResolvedValue({
      success: true,
      found: false,
      create_url: 'https://quotewise.io/create',
    });

    await lookup.lookup('unknown');
    sendMessage.mockClear();

    // Reset storage mock for second call
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({});
    sendMessage.mockResolvedValue({
      success: true,
      found: true,
      originator: mockOriginator,
    });

    const outcome = await lookup.lookup('unknown');

    expect(sendMessage).toHaveBeenCalled();
    expect(outcome.status).toBe('found');
  });

  it('escapes HTML in handle and name', async () => {
    const xssOriginator = {
      ...mockOriginator,
      full_name: '<script>alert("xss")</script>',
    };
    sendMessage.mockResolvedValue({
      success: true,
      found: true,
      originator: xssOriginator,
    });

    await lookup.lookup('<img onerror=alert(1)>');

    expect(container.innerHTML).not.toContain('<script>');
    expect(container.innerHTML).not.toContain('<img');
    expect(container.innerHTML).toContain('&lt;script&gt;');
  });

  it('shows loading state while API call is in progress', async () => {
    let resolveMessage!: (value: Record<string, unknown>) => void;
    sendMessage.mockReturnValue(new Promise((resolve) => {
      resolveMessage = resolve;
    }));

    // Storage must resolve first (no preloaded data) before loading renders
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({});

    const promise = lookup.lookup('pending');

    // Wait for storage check microtask to complete
    await new Promise((r) => setTimeout(r, 0));

    // Check loading state before API resolution
    expect(container.innerHTML).toContain('spinner');
    expect(container.innerHTML).toContain('Looking up @pending');

    resolveMessage({ success: true, found: false });
    await promise;
  });

  it('passes through preloaded duplicate check data', async () => {
    const dupCheck = {
      url: 'https://x.com/test/status/123',
      result: { recommendation: 'new_quote' },
      timestamp: Date.now() - 5000,
    };
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedOriginator: {
        handle: 'einstein',
        originator: mockOriginator,
        timestamp: Date.now() - 5000,
      },
      preloadedDuplicateCheck: dupCheck,
    });

    const outcome = await lookup.lookup('Einstein');

    expect(outcome.preloadedDuplicateCheck).toBe(dupCheck);
  });

  it('uses preloaded not-found result', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedOriginator: {
        handle: 'nobody',
        originator: null,
        create_url: 'https://quotewise.io/create?handle=nobody',
        timestamp: Date.now() - 5000,
      },
    });

    const outcome = await lookup.lookup('Nobody');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(outcome.status).toBe('not_found');
    expect(outcome.createUrl).toBe('https://quotewise.io/create?handle=nobody');
  });

  it('renders a fallback create link when preloaded not-found omits create_url', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedOriginator: {
        handle: 'ericjorgenson',
        originator: null,
        timestamp: Date.now() - 5000,
      },
    });
    sendMessage.mockResolvedValue({ success: true });

    const outcome = await lookup.lookup('EricJorgenson', 'https://x.com/EricJorgenson/status/123');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ORIGINATOR_LOOKUP_STATUS',
      data: {
        handle: 'EricJorgenson',
        platform: 'twitter',
        source_url: 'https://x.com/EricJorgenson/status/123',
        found: false,
        create_url: 'http://quotewise.test:8000/originators/add/?suggested_handle=EricJorgenson&platform=twitter',
      },
    });
    expect(outcome.status).toBe('not_found');
    expect(outcome.createUrl).toBe(
      'http://quotewise.test:8000/originators/add/?suggested_handle=EricJorgenson&platform=twitter'
    );
    expect(container.innerHTML).toContain('Create on Quotewise');
  });

  it('notifies the toolbar when a preloaded not-found result is used for the current tweet', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedOriginator: {
        handle: 'nobody',
        originator: null,
        create_url: 'https://quotewise.io/create?handle=nobody',
        timestamp: Date.now() - 5000,
      },
    });
    sendMessage.mockResolvedValue({ success: true });

    const outcome = await lookup.lookup('Nobody', 'https://x.com/nobody/status/123');

    expect(outcome.status).toBe('not_found');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ORIGINATOR_LOOKUP_STATUS',
      data: {
        handle: 'Nobody',
        platform: 'twitter',
        source_url: 'https://x.com/nobody/status/123',
        found: false,
        create_url: 'https://quotewise.io/create?handle=nobody',
      },
    });
  });

  it('setHtml updates container directly', () => {
    lookup.setHtml('<span>Custom message</span>');
    expect(container.innerHTML).toBe('<span>Custom message</span>');
  });

  it('is case-insensitive for cache keys', async () => {
    sendMessage.mockResolvedValue({
      success: true,
      found: true,
      originator: mockOriginator,
    });

    await lookup.lookup('Einstein');
    sendMessage.mockClear();

    const outcome = await lookup.lookup('EINSTEIN');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(outcome.status).toBe('found');
  });
});
