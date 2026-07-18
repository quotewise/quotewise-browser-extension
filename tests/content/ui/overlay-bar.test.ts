import { OverlayBar } from '../../../src/content/ui/overlay-bar';
import { AuthState } from '../../../src/auth/auth-state-machine';
import { MessageType } from '../../../src/types';
import type { TwitterData } from '../../../src/types';
import type { DuplicateCheckResult } from '../../../src/types/api';
import {
  conflictDuplicateResult,
  couldntVerifyDuplicateResult,
  duplicateMatch,
  duplicateResult,
  similarDuplicateResult,
} from '../../helpers/duplicate-fixtures';

function makeDuplicateResult(
  sightingStatus: DuplicateCheckResult['matches'][number]['sighting_status']
): DuplicateCheckResult {
  return {
    recommendation: 'duplicate',
    confidence: 1,
    in_quotewise: true,
    matches: [{
      quote_id: 'q1',
      version_id: 1,
      text: 'A just submitted quote',
      similarity: 1,
      match_type: 'exact',
      in_user_collections: false,
      member_collections: [],
      originator: { id: '1', full_name: 'Author', sort_name: null, birth_year: null, death_year: null },
      workflow_status: 'published',
      likes_count: 0,
      sighting_status: sightingStatus,
    }],
    reasoning: '',
    search_metadata: {},
    ...(sightingStatus === 'exact_url' ? {
      existing_sightings_for_url: [{
        id: 1,
        quote_id: 'q1',
        source_url: 'https://twitter.com/author/status/123',
        text: 'A just submitted quote',
        web_url: 'https://quotewise.io/q/q1/',
      }],
    } : {}),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushSubmitTimers(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await flushPromises();
    jest.advanceTimersByTime(350);
  }
  await flushPromises();
}

describe('OverlayBar', () => {
  const tweetData: TwitterData = {
    text: 'A just submitted quote',
    author: {
      username: 'author',
      displayName: 'Author',
    },
    url: 'https://twitter.com/author/status/123',
    date: '2026-05-07T12:00:00Z',
    likes: 1,
    retweets: 2,
    replies: 3,
    views: 4,
    bookmarks: 5,
    tweetType: 'original',
    platform_data: {
      tweet_id: '123',
      reply_count: 3,
      retweet_count: 2,
      bookmark_count: 5,
      view_count: 4,
    },
  };

  beforeEach(() => {
    jest.useFakeTimers();
    (chrome.runtime.sendMessage as jest.Mock).mockReset();
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.SUBMIT_QUOTE) {
        callback({ success: true, message: 'Quote submitted successfully', quoteId: 'q1' });
        return;
      }

      callback({ success: true });
    });
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedDuplicateCheck: {
        url: tweetData.url,
        result: { recommendation: 'new_quote' },
        timestamp: Date.now(),
      },
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function setupReadyOverlay(data: TwitterData = tweetData): OverlayBar {
    const overlay = new OverlayBar(async () => data);
    (overlay as any).mount();
    (overlay as any).currentData = data;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).ensureActionButton();
    return overlay;
  }

  function similarResult(): DuplicateCheckResult {
    return similarDuplicateResult({
      matches: [duplicateMatch({
        quote_id: '101',
        text: 'A just submitted quotation',
        quote_date: '2026-06-01T00:00:00Z',
      })],
    });
  }

  function knownUrlResult(existingText = 'An existing passage'): DuplicateCheckResult {
    return duplicateResult({
      recommendation: 'duplicate',
      in_quotewise: true,
      matches: [duplicateMatch({
        quote_id: 'existing',
        text: existingText,
        match_source: 'url',
        match_class: 'exact',
        sighting_status: 'exact_url',
      })],
      existing_sightings_for_url: [{
        id: 1,
        quote_id: 'existing',
        source_url: tweetData.url,
        text: existingText,
        web_url: 'https://quotewise.io/q/existing/',
      }],
      existing_sightings_total: 1,
    });
  }

  it('exposes dialog semantics and manages focus and inert across visibility changes', () => {
    const overlay = new OverlayBar(async () => tweetData);

    overlay.show('Twitter');

    const shadow = (overlay as any).shadow as ShadowRoot;
    const container = shadow.querySelector('.container') as HTMLElement;
    const refreshButton = shadow.getElementById('refresh-btn');
    expect(container.getAttribute('role')).toBe('dialog');
    expect(container.getAttribute('aria-label')).toBe('Quotewise capture tray');
    expect(shadow.getElementById('originator-info')?.getAttribute('aria-live')).toBe('polite');
    expect(container.hasAttribute('inert')).toBe(false);
    expect(shadow.activeElement).toBe(refreshButton);

    shadow.getElementById('close-btn')?.focus();
    overlay.show('Twitter');
    expect(shadow.activeElement).toBe(shadow.getElementById('close-btn'));

    overlay.hide();
    expect(container.hasAttribute('inert')).toBe(true);

    overlay.show('Twitter');
    expect(container.hasAttribute('inert')).toBe(false);
    expect(shadow.activeElement).toBe(refreshButton);
  });

  it('clears stale duplicate preload and auto-hides after 1000ms after successful submit', async () => {
    const overlay = new OverlayBar(async () => tweetData);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };

    await (overlay as any).submitQuote();

    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['preloadedDuplicateCheck']);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('hides the duplicate top-bar source text only when the quote box shows the full source', () => {
    const overlay = setupReadyOverlay();
    const shadow = (overlay as any).shadow as ShadowRoot;
    const sourceText = shadow.getElementById('tweet-preview') as HTMLElement;

    // Collapsed (pre-capture): the top bar is the only source display.
    (overlay as any).captureState.expanded = false;
    (overlay as any).captureState.selectedText = null;
    (overlay as any).syncSourcePreview();
    expect(sourceText.style.display).toBe('');

    // Expanded, no selection: the quote box duplicates it, so hide the top copy.
    (overlay as any).captureState.expanded = true;
    (overlay as any).syncSourcePreview();
    expect(sourceText.style.display).toBe('none');

    // Expanded with a selection: top bar shows the full source alongside the selection.
    (overlay as any).captureState.selectedText = 'just submitted';
    (overlay as any).syncSourcePreview();
    expect(sourceText.style.display).toBe('');
  });

  it('collapses an expanded capture when refresh no longer finds a post', async () => {
    const overlay = setupReadyOverlay();
    await flushPromises();
    (overlay as any).captureState.expanded = true;
    (overlay as any).updateSubmitButton(true);
    (overlay as any).dataProvider = jest.fn().mockResolvedValue(null);

    await overlay.refresh();

    const shadow = (overlay as any).shadow as ShadowRoot;
    const submitButton = shadow.getElementById('submit-btn') as HTMLButtonElement;
    expect((overlay as any).captureState.expanded).toBe(false);
    expect(submitButton.disabled).toBe(true);

    submitButton.click();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function),
    );
  });

  it('distinguishes a textless post from no supported post and disables Submit', async () => {
    const overlay = setupReadyOverlay();
    await flushPromises();
    const shadow = (overlay as any).shadow as ShadowRoot;

    (overlay as any).captureState.expanded = true;
    (overlay as any).updateSubmitButton(true);
    (overlay as any).dataProvider = jest.fn().mockResolvedValue({ empty: 'no-text' });

    await overlay.refresh();

    expect(shadow.getElementById('tweet-preview')?.textContent).toBe('This post has no quotable text.');
    expect((overlay as any).captureState.expanded).toBe(false);
    expect((shadow.getElementById('submit-btn') as HTMLButtonElement | null)?.disabled ?? true).toBe(true);

    (overlay as any).dataProvider = jest.fn().mockResolvedValue({ empty: 'no-post' });
    await overlay.refresh();

    expect(shadow.getElementById('tweet-preview')?.textContent)
      .toBe('No supported post detected on this page.');
  });

  it('shows the expired-session login state when auth expires during capture', async () => {
    const overlay = setupReadyOverlay();
    await flushPromises();
    (overlay as any).captureState.expanded = true;
    (overlay as any).updateSubmitButton(true);

    (overlay as any).handleAuthStateChanged({
      state: AuthState.SESSION_EXPIRED,
      lastCheckedAt: Date.now(),
    });

    const shadow = (overlay as any).shadow as ShadowRoot;
    expect(shadow.textContent).toContain('Session expired, please log in again');
    expect(shadow.getElementById('submit-btn')).toBeNull();
    expect(shadow.getElementById('login-btn')).toBeTruthy();
  });

  it('shows login when logout lands before originator lookup completes', async () => {
    const overlay = setupReadyOverlay();
    await flushPromises();
    (overlay as any).captureState.expanded = true;
    (overlay as any).captureState.originator = null;
    (overlay as any).updateSubmitButton(true);

    (overlay as any).handleAuthStateChanged({
      state: AuthState.UNAUTHENTICATED,
      lastCheckedAt: Date.now(),
    });

    const shadow = (overlay as any).shadow as ShadowRoot;
    expect(shadow.textContent).toContain('Click to log in');
    expect(shadow.getElementById('submit-btn')).toBeNull();
    expect(shadow.getElementById('login-btn')).toBeTruthy();
  });

  it('shows the specific auth state when an expired session is detected on initial open', async () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).mount();
    await flushPromises();
    (overlay as any).currentData = tweetData;
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        callback({ success: true, data: { state: AuthState.SESSION_EXPIRED } });
        return;
      }
      callback({ success: true });
    });

    await (overlay as any).expandCapture();

    const shadow = (overlay as any).shadow as ShadowRoot;
    expect(shadow.textContent).toContain('Session expired, please log in again');
    expect(shadow.getElementById('submit-btn')).toBeNull();
    expect(shadow.getElementById('login-btn')).toBeTruthy();
  });

  it('submits a similar match as a sighting with the linked quote id and confirmation copy', async () => {
    const overlay = setupReadyOverlay();
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.SUBMIT_QUOTE) {
        callback({ success: true, message: 'Sighting added', quoteId: 'q1', action: 'sighting_added' });
        return;
      }

      callback({ success: true });
    });

    (overlay as any).updateDuplicateInfo({ result: similarResult() });
    const shadow = (overlay as any).shadow as ShadowRoot;
    const sightingButton = [...shadow.querySelectorAll('button')]
      .find(button => button.textContent === 'Add another sighting') as HTMLButtonElement;

    sightingButton.click();
    await flushSubmitTimers();

    const submitCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(c => c[0]?.type === MessageType.SUBMIT_QUOTE);
    expect(submitCall?.[0].data.link_to_quote_id).toBe(101);
    expect(submitCall?.[0].data.user_intent).toBe('sighting');
    expect(shadow.getElementById('originator-info')?.textContent).toContain('Sighting added');
  });

  it('keeps the full-source preview intact beside a similar-match diff', () => {
    const overlay = setupReadyOverlay();
    (overlay as any).updateQuotePreview();
    (overlay as any).updateDuplicateInfo({ result: similarResult() });

    const shadow = (overlay as any).shadow as ShadowRoot;
    const center = shadow.querySelector('.quote-preview-row .section.center') as HTMLElement;
    const preview = shadow.getElementById('quote-preview') as HTMLElement;
    const diff = center.querySelector(':scope > .similar-diff') as HTMLElement;

    expect([...center.children]).toEqual(expect.arrayContaining([preview, diff]));
    expect(preview.contains(diff)).toBe(false);
    expect(preview.querySelector('.quote-text')?.textContent).toBe(tweetData.text);
  });

  it('submits a similar match as a variant with the linked quote id and confirmation copy', async () => {
    const overlay = setupReadyOverlay();
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.SUBMIT_QUOTE) {
        callback({ success: true, message: 'Quote created', quoteId: 'q1', action: 'created' });
        return;
      }

      callback({ success: true });
    });

    (overlay as any).updateDuplicateInfo({ result: similarResult() });
    const shadow = (overlay as any).shadow as ShadowRoot;
    const variantButton = [...shadow.querySelectorAll('button')]
      .find(button => button.textContent === 'Add as variant') as HTMLButtonElement;

    variantButton.click();
    await flushSubmitTimers();

    const submitCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(c => c[0]?.type === MessageType.SUBMIT_QUOTE);
    expect(submitCall?.[0].data.link_to_quote_id).toBe(101);
    expect(submitCall?.[0].data.user_intent).toBe('variant');
    expect(shadow.getElementById('originator-info')?.textContent).toContain('Added as variant');
  });

  it('double-clicking a similar-match decision submits exactly once', async () => {
    const overlay = setupReadyOverlay();
    (overlay as any).updateDuplicateInfo({ result: similarResult() });
    const shadow = (overlay as any).shadow as ShadowRoot;
    const variantButton = [...shadow.querySelectorAll('button')]
      .find(button => button.textContent === 'Add as variant') as HTMLButtonElement;

    variantButton.click();
    variantButton.click();
    await flushSubmitTimers();

    const submitCalls = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .filter(c => c[0]?.type === MessageType.SUBMIT_QUOTE);
    expect(submitCalls).toHaveLength(1);
  });

  it('double-clicking the plain Submit button submits exactly once', async () => {
    const overlay = setupReadyOverlay();
    (overlay as any).updateSubmitButton(true);
    const shadow = (overlay as any).shadow as ShadowRoot;
    const submitButton = shadow.getElementById('submit-btn') as HTMLButtonElement;

    submitButton.dispatchEvent(new MouseEvent('click'));
    submitButton.dispatchEvent(new MouseEvent('click'));
    await flushSubmitTimers();

    const submitCalls = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .filter(c => c[0]?.type === MessageType.SUBMIT_QUOTE);
    expect(submitCalls).toHaveLength(1);
  });

  it('blocks submit and offers retry when duplicate verification could not complete', async () => {
    const overlay = setupReadyOverlay();
    const checkDuplicate = jest.spyOn(overlay as any, 'checkDuplicate').mockResolvedValue(undefined);
    (overlay as any).captureState.duplicateResult = couldntVerifyDuplicateResult();

    (overlay as any).updateDuplicateInfo({ result: (overlay as any).captureState.duplicateResult });
    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );

    const shadow = (overlay as any).shadow as ShadowRoot;
    const submitButton = shadow.getElementById('submit-btn') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.textContent).toBe("Couldn't Verify");

    const retryButton = [...shadow.querySelectorAll('button')]
      .find(button => button.textContent === 'Retry') as HTMLButtonElement;
    retryButton.click();
    expect(checkDuplicate).toHaveBeenCalledWith('author');
  });

  it('re-enables submit when a retry returns a clean new quote result', () => {
    const overlay = setupReadyOverlay();
    (overlay as any).updateDuplicateInfo({ result: couldntVerifyDuplicateResult() });

    const shadow = (overlay as any).shadow as ShadowRoot;
    const submitButton = shadow.getElementById('submit-btn') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.textContent).toBe("Couldn't Verify");

    (overlay as any).updateDuplicateInfo({ result: duplicateResult() });

    expect(submitButton.disabled).toBe(false);
    expect(submitButton.textContent).toBe('Submit Quote');
  });

  it('blocks submit for attribution conflicts and shows a resolve link without decision buttons', async () => {
    const overlay = setupReadyOverlay();
    const conflict = conflictDuplicateResult();
    (overlay as any).captureState.duplicateResult = conflict;

    (overlay as any).updateDuplicateInfo({ result: conflict });
    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );

    const shadow = (overlay as any).shadow as ShadowRoot;
    expect(shadow.textContent).toContain('Already attributed to Different Author');
    expect(shadow.textContent).toContain('Resolve in Quotewise');
    expect(shadow.textContent).not.toContain('Add another sighting');
    expect(shadow.textContent).not.toContain('Add as variant');

    const submitButton = shadow.getElementById('submit-btn') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.textContent).toBe('Resolve Attribution');
  });

  it('shows each submit progress phase before success', async () => {
    let submitCallback: (response: unknown) => void = () => undefined;
    let submitRequested = false;
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.SUBMIT_QUOTE) {
        submitRequested = true;
        submitCallback = callback;
        return;
      }

      callback({ success: true });
    });

    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).mount();
    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).ensureActionButton();

    const submitPromise = (overlay as any).submitQuote();
    await flushPromises();

    const shadow = (overlay as any).shadow as ShadowRoot;
    const actionColumn = shadow.querySelector('.originator-row .section.right');
    expect(shadow.getElementById('progress-indicator')?.textContent).toContain('Checking quote');
    expect(actionColumn?.firstElementChild?.id).toBe('progress-indicator');
    expect(shadow.querySelector('.progress-track')).toBeTruthy();
    expect((shadow.getElementById('submit-btn') as HTMLButtonElement).textContent).toBe('Submitting...');

    jest.advanceTimersByTime(350);
    await flushPromises();

    expect(shadow.getElementById('progress-indicator')?.textContent).toContain('Saving to Quotewise');
    expect((shadow.getElementById('submit-btn') as HTMLButtonElement).textContent).toBe('Submitting...');
    expect(submitRequested).toBe(true);

    submitCallback({ success: true, message: 'Quote submitted successfully', quoteId: 'q1' });
    await flushPromises();

    expect(shadow.getElementById('progress-indicator')?.textContent).toContain('Confirming');
    expect((shadow.getElementById('submit-btn') as HTMLButtonElement).textContent).toBe('Submitting...');

    jest.advanceTimersByTime(350);
    await submitPromise;

    expect((shadow.getElementById('submit-btn') as HTMLButtonElement).textContent).toBe('Done!');
    expect(shadow.getElementById('originator-info')?.textContent).toContain('Quote added successfully!');
  });

  it('shows submit failure and successfully retries', async () => {
    let submitAttempts = 0;
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.SUBMIT_QUOTE) {
        submitAttempts += 1;
        callback(submitAttempts === 1
          ? { success: false, error: 'Service unavailable' }
          : { success: true, message: 'Quote submitted successfully', quoteId: 'q1' });
        return;
      }
      callback({ success: true });
    });
    const overlay = setupReadyOverlay();
    (overlay as any).updateSubmitButton(true);
    const shadow = (overlay as any).shadow as ShadowRoot;
    const submitButton = shadow.getElementById('submit-btn') as HTMLButtonElement;

    submitButton.click();
    await flushSubmitTimers();

    expect(shadow.getElementById('originator-info')?.textContent)
      .toContain('Submit failed: Service unavailable');
    expect(submitButton.textContent).toBe('Retry');
    expect(submitButton.disabled).toBe(false);

    submitButton.click();
    await flushSubmitTimers();

    expect(submitAttempts).toBe(2);
    expect(shadow.getElementById('originator-info')?.textContent)
      .toContain('Quote added successfully!');
  });

  it('blocks submit when the exact sighting already exists', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.duplicateResult = makeDuplicateResult('exact_url');

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('blocks submit when a same-platform sighting already exists', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.duplicateResult = makeDuplicateResult('has_platform_sighting');

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('does not submit on an article page when nothing is selected', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = { ...tweetData, isArticle: true };
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.selectedText = null;

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('submits on an article page when a passage is selected', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = { ...tweetData, isArticle: true };
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.selectedText = 'a highlighted passage';

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('allows submit when only other-platform sightings exist', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };
    (overlay as any).captureState.duplicateResult = makeDuplicateResult('no_platform_sighting');

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('submits with originator_slug, not the deprecated numeric originator_id', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = { ...tweetData };
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'kpaxs',
      full_name: 'Kpaxs',
      sort_name_display: 'Kpaxs',
      confidence: 1,
    };

    await (overlay as any).submitQuote();

    const submitCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(c => c[0]?.type === MessageType.SUBMIT_QUOTE);
    expect(submitCall).toBeDefined();
    expect(submitCall[0].data.originator_slug).toBe('kpaxs');
    expect(submitCall[0].data.originator_id).toBeUndefined();
  });

  it('does not submit when the resolved originator has no slug', async () => {
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).currentData = { ...tweetData };
    (overlay as any).captureState.originator = {
      // No unique_id — e.g. a resolution path that failed to supply a slug.
      full_name: 'Kpaxs',
      sort_name_display: 'Kpaxs',
      confidence: 1,
    };

    await (overlay as any).submitQuote();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function)
    );
  });

  it('checks duplicates by originator_slug', async () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).currentData = { ...tweetData };

    await (overlay as any).checkDuplicate('kpaxs');

    const dupCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(c => c[0]?.type === MessageType.CHECK_DUPLICATE);
    expect(dupCall).toBeDefined();
    expect(dupCall[0].data.originator_slug).toBe('kpaxs');
    expect(dupCall[0].data.originator_id).toBeUndefined();
  });

  it('forces a fresh duplicate check on tray refresh so collection membership is updated', async () => {
    const overlay = setupReadyOverlay();
    (overlay as any).captureState.expanded = true;
    (overlay as any).collectionPicker = { refresh: jest.fn().mockResolvedValue(undefined) };

    const collectedResult = makeDuplicateResult('exact_url');
    collectedResult.matches[0].in_user_collections = true;
    collectedResult.matches[0].member_collections = [{ slug: 'favorites', name: 'Favorites' }];

    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.CHECK_DUPLICATE) {
        callback({ success: true, result: collectedResult });
        return;
      }

      callback({ success: true });
    });

    await (overlay as any).refreshFromTray();
    await flushPromises();

    const dupCall = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .find(c => c[0]?.type === MessageType.CHECK_DUPLICATE);
    expect(dupCall?.[0].data.originator_slug).toBe('author');

    const shadow = (overlay as any).shadow as ShadowRoot;
    expect(shadow.textContent).toContain('In your collection: Favorites');
  });

  it('force-refreshes a missing originator instead of reusing preloaded not-found data', async () => {
    const overlay = setupReadyOverlay();
    (overlay as any).captureState.expanded = true;
    (overlay as any).captureState.originator = null;
    (overlay as any).captureState.lookupResult = 'not_found';
    (overlay as any).captureState.createUrl = 'https://quotewise.io/create?handle=author';
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      preloadedOriginator: {
        handle: 'author',
        originator: null,
        timestamp: Date.now() - 5000,
      },
    });
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.LOOKUP_ORIGINATOR_BY_HANDLE) {
        callback({
          success: true,
          found: true,
          originator: {
            id: 42,
            unique_id: 'author',
            full_name: 'Author',
            sort_name_display: 'Author',
            confidence: 1,
          },
        });
        return;
      }

      if (message.type === MessageType.CHECK_DUPLICATE) {
        callback({ success: true, result: duplicateResult({ recommendation: 'new_quote' }) });
        return;
      }

      callback({ success: true });
    });

    await (overlay as any).refreshFromTray();
    await flushPromises();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.LOOKUP_ORIGINATOR_BY_HANDLE,
        data: expect.objectContaining({ handle: 'author' }),
      }),
      expect.any(Function),
    );
    expect((overlay as any).captureState.originator?.unique_id).toBe('author');
  });

  it('live-updates the selection when the user highlights after opening (article)', () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).currentData = { ...tweetData, isArticle: true };
    (overlay as any).captureState.originator = {
      id: 1, unique_id: 'kpaxs', full_name: 'Kpaxs', sort_name_display: 'Kpaxs', confidence: 1,
    };
    (overlay as any).captureState.selectedText = null;
    jest.spyOn(overlay as any, 'getPageSelection').mockReturnValue('a highlighted article passage');

    (overlay as any).onPageSelectionChanged();

    expect((overlay as any).captureState.selectedText).toBe('a highlighted article passage');
  });

  it('allows a distinct selection at a known URL and blocks its matching passage', () => {
    const overlay = setupReadyOverlay();
    const originator = (overlay as any).captureState.originator;
    const result = knownUrlResult();
    const shadow = (overlay as any).shadow as ShadowRoot;

    (overlay as any).captureState.selectedText = 'A new passage';
    (overlay as any).captureState.duplicateResult = result;
    (overlay as any).updateQuotePreview();
    (overlay as any).updateDuplicateInfo({ result });

    const submitButton = shadow.getElementById('submit-btn') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    expect(submitButton.textContent).toBe('Capture another passage');
    expect(shadow.textContent).toContain('This post already has a captured quote');
    expect(shadow.textContent).toContain('A new passage');
    expect((overlay as any).captureState.originator).toBe(originator);

    (overlay as any).captureState.selectedText = 'An existing passage';
    (overlay as any).updateQuotePreview();
    (overlay as any).updateDuplicateInfo({ result });

    expect(shadow.textContent).toContain('Already captured this passage');
    expect(shadow.getElementById('submit-btn')).toBeNull();
    expect(shadow.getElementById('view-quote-btn')).toBeTruthy();
  });

  it('reclassifies from cached URL data immediately while the selection lookup stays non-blocking', () => {
    const overlay = setupReadyOverlay();
    const result = knownUrlResult();
    (overlay as any).captureState.duplicateResult = result;
    jest.spyOn(overlay as any, 'getPageSelection').mockReturnValue('A cached new passage');
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type !== MessageType.CHECK_DUPLICATE) callback({ success: true });
    });

    (overlay as any).onPageSelectionChanged();

    const shadow = (overlay as any).shadow as ShadowRoot;
    const submitButton = shadow.getElementById('submit-btn') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    expect(submitButton.textContent).toBe('Capture another passage');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: MessageType.CHECK_DUPLICATE,
      data: expect.objectContaining({ text: 'A cached new passage' }),
    }), expect.any(Function));
  });

  it('drops a fuzzy response for a superseded selection', async () => {
    const overlay = setupReadyOverlay();
    (overlay as any).captureState.duplicateResult = knownUrlResult();
    const selections = jest.spyOn(overlay as any, 'getPageSelection');
    selections.mockReturnValueOnce('First passage').mockReturnValueOnce('Second passage');
    const duplicateCallbacks: Array<(response: unknown) => void> = [];
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.CHECK_DUPLICATE) {
        duplicateCallbacks.push(callback);
      } else {
        callback({ success: true });
      }
    });

    (overlay as any).onPageSelectionChanged();
    (overlay as any).onPageSelectionChanged();
    expect(duplicateCallbacks).toHaveLength(2);

    const latestResult = similarDuplicateResult({
      matches: [duplicateMatch({ text: 'Second passage with a small difference' })],
    });
    duplicateCallbacks[1]({ success: true, result: latestResult });
    await flushPromises();
    duplicateCallbacks[0]({ success: true, result: couldntVerifyDuplicateResult() });
    await flushPromises();

    expect((overlay as any).captureState.selectedText).toBe('Second passage');
    expect((overlay as any).captureState.duplicateResult).toBe(latestResult);
    expect(((overlay as any).shadow as ShadowRoot).textContent).not.toContain("Couldn't verify duplicates");
  });

  it('submits distinct passages with the same source URL', async () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).currentData = tweetData;
    (overlay as any).captureState.originator = {
      id: 42,
      unique_id: 'author',
      full_name: 'Author',
      sort_name_display: 'Author',
      confidence: 1,
    };

    (overlay as any).captureState.selectedText = 'First passage';
    await (overlay as any).submitQuote();
    (overlay as any).captureState.selectedText = 'Second passage';
    await (overlay as any).submitQuote();

    const submits = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .map(([message]) => message)
      .filter(message => message.type === MessageType.SUBMIT_QUOTE);
    expect(submits.map(message => message.data.text)).toEqual(['First passage', 'Second passage']);
    expect(submits.map(message => message.data.source_url)).toEqual([tweetData.url, tweetData.url]);
  });

  it('keeps authentication and unreadable-post gates ahead of multi-passage capture', async () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).mount();
    await flushPromises();
    (overlay as any).currentData = tweetData;
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message, callback) => {
      if (message.type === MessageType.AUTH_STATE_GET) {
        callback({ success: true, data: { state: 'UNAUTHENTICATED' } });
      } else {
        callback({ success: true });
      }
    });

    await (overlay as any).expandCapture();
    const shadow = (overlay as any).shadow as ShadowRoot;
    expect(shadow.textContent).toContain('Click to log in');
    expect(shadow.getElementById('login-btn')).toBeTruthy();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.CHECK_DUPLICATE }),
      expect.any(Function),
    );

    (overlay as any).currentData = null;
    (overlay as any).captureState.originator = { unique_id: 'author' };
    await (overlay as any).submitQuote();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.SUBMIT_QUOTE }),
      expect.any(Function),
    );
  });

  it('latches: does not clear an existing selection when selectionchange reports nothing', () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).currentData = { ...tweetData, isArticle: true };
    (overlay as any).captureState.selectedText = 'previously selected';
    jest.spyOn(overlay as any, 'getPageSelection').mockReturnValue(null);

    (overlay as any).onPageSelectionChanged();

    expect((overlay as any).captureState.selectedText).toBe('previously selected');
  });

  it('closes the tray when Escape is pressed', () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).mount();
    expect(overlay.isVisible()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(overlay.isVisible()).toBe(false);
  });

  it('leaves the tray open for non-Escape keys', () => {
    const overlay = new OverlayBar(async () => tweetData);
    (overlay as any).mount();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(overlay.isVisible()).toBe(true);
  });

  it('attaches and detaches the selectionchange watcher', () => {
    const addSpy = jest.spyOn(document, 'addEventListener');
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    const overlay = new OverlayBar(async () => tweetData);

    (overlay as any).startSelectionWatcher();
    expect(addSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function));

    (overlay as any).stopSelectionWatcher();
    expect(removeSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('does not expose an editable quote-text input', () => {
    const overlay = setupReadyOverlay();
    const shadow = (overlay as any).shadow as ShadowRoot;

    expect(shadow.querySelector('textarea')).toBeNull();
    expect(shadow.querySelector('input[type="text"]')).toBeNull();
    expect(shadow.querySelector('[contenteditable="true"]')).toBeNull();
  });
});
