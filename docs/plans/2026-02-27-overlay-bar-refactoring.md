# Overlay Bar Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Delete ~3,500 lines of dead popup code and decompose the 1,139-line overlay bar into focused, testable components.

**Architecture:** Extract four component classes (QuotePreview, OriginatorLookup, DuplicateBadge, ActionButton) from the monolithic OverlayBar. Each component owns a DOM container and exposes an `update()` method. OverlayBar remains the orchestrator: it mounts the Shadow DOM, holds CaptureState, and coordinates the capture flow.

**Tech Stack:** TypeScript, Chrome Extension MV3, Shadow DOM, Jest + jsdom

---

### Task 1: Delete Dead Popup Code

**Files:**
- Delete: `src/popup/popup.ts`
- Delete: `src/duplicate/duplicate-display.ts`
- Delete: `src/duplicate/duplicate-checker.ts`
- Delete: `src/search/originator-search.ts`
- Delete: `src/lookup/handle-lookup.ts`
- Delete: `src/lookup/handle-lookup-display.ts`
- Delete: `public/popup.html`
- Delete: `public/popup.css`
- Delete: `tests/popup/popup.test.ts`
- Delete: `tests/duplicate/duplicate-display.test.ts`
- Delete: `tests/duplicate/duplicate-checker.test.ts`
- Delete: `tests/search/originator-search.test.ts`
- Delete: `tests/lookup/handle-lookup.test.ts`
- Delete: `tests/lookup/handle-lookup-display.test.ts`
- Modify: `webpack.config.js:15` — remove `'popup/popup': './src/popup/popup.ts'` entry
- Modify: `webpack.config.js:30` — remove `'@popup': path.resolve(__dirname, 'src/popup')` alias
- Modify: `tsconfig.json:23` — remove `"@popup/*": ["popup/*"]` path
- Modify: `manifest.prod.json:60-68` — remove the web_accessible_resources entry for popup.html/popup.css
- Modify: `manifest.dev.json` — remove same popup references if present

**Step 1: Delete all dead files**

```bash
rm src/popup/popup.ts
rm src/duplicate/duplicate-display.ts
rm src/duplicate/duplicate-checker.ts
rm src/search/originator-search.ts
rm src/lookup/handle-lookup.ts
rm src/lookup/handle-lookup-display.ts
rm public/popup.html
rm public/popup.css
rm tests/popup/popup.test.ts
rm tests/duplicate/duplicate-display.test.ts
rm tests/duplicate/duplicate-checker.test.ts
rm tests/search/originator-search.test.ts
rm tests/lookup/handle-lookup.test.ts
rm tests/lookup/handle-lookup-display.test.ts
```

Then remove empty directories:

```bash
rmdir src/popup src/duplicate src/search src/lookup tests/popup tests/duplicate tests/search tests/lookup
```

**Step 2: Remove popup from webpack.config.js**

In `webpack.config.js`, remove line 15 (`'popup/popup'` entry) and line 30 (`@popup` alias).

**Step 3: Remove popup from tsconfig.json**

In `tsconfig.json`, remove line 23 (`"@popup/*": ["popup/*"]`).

**Step 4: Remove popup from manifest.prod.json**

Remove the web_accessible_resources entry at lines 60-68 (the block with `popup.html` and `popup.css`).

**Step 5: Check manifest.dev.json for same references and remove**

**Step 6: Verify build and tests**

```bash
bun run type-check
bun run build
bun run test
```

Expected: All pass. Test count drops significantly (popup tests removed). Build output no longer includes `popup/popup.js`.

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: delete dead popup code (~3,500 lines)

Remove disabled popup UI and all its dependencies:
- popup.ts, popup.html, popup.css
- duplicate-checker.ts, duplicate-display.ts
- originator-search.ts
- handle-lookup.ts, handle-lookup-display.ts
- All corresponding test files
- Webpack entry, path aliases, manifest references"
```

---

### Task 2: Extract DuplicateBadge Component

**Files:**
- Create: `src/content/ui/components/duplicate-badge.ts`
- Create: `tests/content/ui/components/duplicate-badge.test.ts`
- Modify: `src/content/ui/overlay-bar.ts` — replace `updateDuplicateInfo` with DuplicateBadge

**Step 1: Write the failing test**

Create `tests/content/ui/components/duplicate-badge.test.ts`:

```typescript
import { DuplicateBadge } from '../../../../src/content/ui/components/duplicate-badge';
import type { DuplicateCheckResult } from '../../../../src/types/api';

describe('DuplicateBadge', () => {
  let container: HTMLElement;
  let badge: DuplicateBadge;
  let onSubmitStateChange: jest.Mock;

  beforeEach(() => {
    container = document.createElement('div');
    onSubmitStateChange = jest.fn();
    badge = new DuplicateBadge(container, { onSubmitStateChange });
  });

  it('shows spinner when checking', () => {
    badge.update({ checking: true });
    expect(container.querySelector('.spinner')).toBeTruthy();
  });

  it('shows nothing for null state', () => {
    badge.update(null);
    expect(container.innerHTML).toBe('');
  });

  it('shows "Already captured" link for exact_url match with url', () => {
    const result: DuplicateCheckResult = {
      recommendation: 'duplicate',
      confidence: 1.0,
      in_quotewise: true,
      matches: [{
        quote_id: '123',
        version_id: 1,
        text: 'test quote',
        similarity: 1.0,
        match_type: 'exact',
        in_user_collections: false,
        originator: { id: '1', full_name: 'Test', sort_name: null, birth_year: null, death_year: null },
        workflow_status: 'approved',
        likes_count: 0,
        sighting_status: 'exact_url',
        url: 'https://quotewise.io/q/abc123/'
      }],
      reasoning: 'Exact match',
      search_metadata: {}
    };
    badge.update({ result });

    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link?.href).toBe('https://quotewise.io/q/abc123/');
    expect(link?.textContent).toContain('Already captured');
    expect(onSubmitStateChange).toHaveBeenCalledWith({ enabled: false, text: 'Already Captured' });
  });

  it('shows "Platform sighting exists" link for has_platform_sighting', () => {
    const result: DuplicateCheckResult = {
      recommendation: 'duplicate',
      confidence: 0.95,
      in_quotewise: true,
      matches: [{
        quote_id: '456',
        version_id: 2,
        text: 'another quote',
        similarity: 0.95,
        match_type: 'semantic',
        in_user_collections: false,
        originator: { id: '2', full_name: 'Author', sort_name: null, birth_year: null, death_year: null },
        workflow_status: 'approved',
        likes_count: 5,
        sighting_status: 'has_platform_sighting',
        url: 'https://quotewise.io/q/def456/'
      }],
      reasoning: 'Platform sighting exists',
      search_metadata: {}
    };
    badge.update({ result });

    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link?.href).toBe('https://quotewise.io/q/def456/');
    expect(onSubmitStateChange).toHaveBeenCalledWith({ enabled: true, text: 'Add Another Sighting', style: 'warning' });
  });

  it('shows nothing for new_quote recommendation', () => {
    const result: DuplicateCheckResult = {
      recommendation: 'new_quote',
      confidence: 0.1,
      in_quotewise: false,
      matches: [],
      reasoning: 'No similar quotes',
      search_metadata: {}
    };
    badge.update({ result });
    expect(container.innerHTML).toBe('');
  });

  it('shows warning badge for duplicate recommendation', () => {
    const result: DuplicateCheckResult = {
      recommendation: 'duplicate',
      confidence: 0.9,
      in_quotewise: true,
      matches: [{
        quote_id: '789',
        version_id: 3,
        text: 'dup quote',
        similarity: 0.92,
        match_type: 'fuzzy',
        in_user_collections: false,
        originator: { id: '3', full_name: 'Person', sort_name: null, birth_year: null, death_year: null },
        workflow_status: 'approved',
        likes_count: 0,
        sighting_status: undefined
      }],
      reasoning: 'Duplicate',
      search_metadata: {}
    };
    badge.update({ result });
    expect(container.textContent).toContain('Duplicate');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun run test -- tests/content/ui/components/duplicate-badge.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement DuplicateBadge**

Create `src/content/ui/components/duplicate-badge.ts`:

```typescript
import type { DuplicateCheckResult } from '../../../types/api';

export interface SubmitStateDirective {
  enabled: boolean;
  text: string;
  style?: 'success' | 'warning';
}

export interface DuplicateBadgeCallbacks {
  onSubmitStateChange: (directive: SubmitStateDirective) => void;
}

export class DuplicateBadge {
  constructor(
    private container: HTMLElement,
    private callbacks: DuplicateBadgeCallbacks
  ) {}

  update(state: { checking: true } | { result: DuplicateCheckResult } | null): void {
    // Clear existing content
    this.container.innerHTML = '';

    if (!state) return;

    if ('checking' in state) {
      this.container.innerHTML = '<div class="spinner" style="width:12px;height:12px;"></div>';
      this.container.title = 'Checking for duplicates...';
      return;
    }

    const { result } = state;
    const firstMatch = result.matches?.[0];
    const sightingStatus = firstMatch?.sighting_status;

    if (sightingStatus === 'exact_url') {
      this.renderBadge('success', '🟢', 'Already captured', firstMatch?.url);
      this.container.title = 'This exact URL is already in Quotewise';
      this.callbacks.onSubmitStateChange({ enabled: false, text: 'Already Captured' });
    } else if (sightingStatus === 'has_platform_sighting') {
      this.renderBadge('warning', '🟡', 'Platform sighting exists', firstMatch?.url);
      this.container.title = 'A Twitter sighting exists for this quote - you can add another if needed';
      this.callbacks.onSubmitStateChange({ enabled: true, text: 'Add Another Sighting', style: 'warning' });
    } else if (sightingStatus === 'no_platform_sighting') {
      this.renderBadge('info', '🔵', 'Add sighting');
      this.container.title = 'Quote exists but no Twitter sighting yet - adding this will create one';
    } else if (result.recommendation === 'duplicate') {
      this.renderBadge('warning', '⚠️', 'Duplicate');
      this.container.title = result.reasoning || 'This quote may already exist';
    } else if (result.recommendation === 'new_version') {
      this.renderBadge('info', 'ℹ️', 'New version');
      this.container.title = result.reasoning || 'Similar quote exists - will create new version';
    } else if (result.in_quotewise) {
      this.renderBadge('success', '✓', 'In Quotewise');
      this.container.title = 'Quote already in collection';
    }
    // No badge for new_quote — that's the expected case
  }

  private renderBadge(cssClass: string, icon: string, text: string, linkUrl?: string): void {
    this.container.className = `duplicate-badge badge ${cssClass}`;
    this.container.style.marginLeft = '8px';

    if (linkUrl) {
      this.container.innerHTML = `<a href="${this.escapeHtml(linkUrl)}" target="_blank" style="color:inherit;text-decoration:none;">${icon} ${this.escapeHtml(text)} ↗</a>`;
    } else {
      this.container.innerHTML = `${icon} ${this.escapeHtml(text)}`;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun run test -- tests/content/ui/components/duplicate-badge.test.ts
```

Expected: PASS

**Step 5: Wire DuplicateBadge into OverlayBar**

In `overlay-bar.ts`:
- Import `DuplicateBadge`
- In `mount()` or when capture row expands, create a persistent badge container element and instantiate `DuplicateBadge`
- Replace the `updateDuplicateInfo` method body with `this.duplicateBadge.update(state)`
- The callback `onSubmitStateChange` calls `updateSubmitButton` / `updateSubmitButtonWarning` as appropriate

**Step 6: Run full test suite and type check**

```bash
bun run type-check
bun run test
```

**Step 7: Commit**

```bash
git add src/content/ui/components/duplicate-badge.ts tests/content/ui/components/duplicate-badge.test.ts src/content/ui/overlay-bar.ts
git commit -m "refactor: extract DuplicateBadge component from overlay bar"
```

---

### Task 3: Extract QuotePreview Component

**Files:**
- Create: `src/content/ui/components/quote-preview.ts`
- Create: `tests/content/ui/components/quote-preview.test.ts`
- Modify: `src/content/ui/overlay-bar.ts` — replace `updateQuotePreview`, `updateQuotePreviewSuccess`, `getPageSelection`

**Step 1: Write the failing test**

Create `tests/content/ui/components/quote-preview.test.ts`:

```typescript
import { QuotePreview } from '../../../../src/content/ui/components/quote-preview';

describe('QuotePreview', () => {
  let container: HTMLElement;
  let preview: QuotePreview;
  let onClearSelection: jest.Mock;

  beforeEach(() => {
    container = document.createElement('div');
    onClearSelection = jest.fn();
    preview = new QuotePreview(container, { onClearSelection });
  });

  it('shows full text when no selection', () => {
    preview.update('This is the full tweet text.', null);
    expect(container.textContent).toContain('This is the full tweet text.');
    expect(container.querySelector('.clear-selection')).toBeNull();
  });

  it('shows selected text with clear button', () => {
    preview.update('Full text', 'selected portion');
    expect(container.textContent).toContain('selected portion');
    expect(container.querySelector('.clear-selection')).toBeTruthy();
  });

  it('calls onClearSelection when clear button clicked', () => {
    preview.update('Full text', 'selected portion');
    const clearBtn = container.querySelector('.clear-selection') as HTMLElement;
    clearBtn.click();
    expect(onClearSelection).toHaveBeenCalled();
  });

  it('truncates long text to 100 chars', () => {
    const longText = 'A'.repeat(150);
    preview.update(longText, null);
    const displayed = container.querySelector('.quote-text')?.textContent || '';
    expect(displayed.length).toBeLessThan(150);
    expect(displayed).toContain('...');
  });

  it('shows success state', () => {
    preview.showSuccess('Submitted text', false);
    expect(container.textContent).toContain('Submitted');
  });

  it('shows success state with selection badge', () => {
    preview.showSuccess('Selected text', true);
    expect(container.textContent).toContain('Selection');
    expect(container.textContent).toContain('Submitted');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun run test -- tests/content/ui/components/quote-preview.test.ts
```

**Step 3: Implement QuotePreview**

Create `src/content/ui/components/quote-preview.ts`. Extract the logic from `updateQuotePreview()` (overlay-bar.ts lines 571-596) and `updateQuotePreviewSuccess()` (lines 601-623). Also move `getPageSelection()` (lines 548-566) as a static method.

**Step 4: Run test, verify pass**

**Step 5: Wire into OverlayBar, replacing inline methods**

**Step 6: Run full test suite and type check**

**Step 7: Commit**

```bash
git add src/content/ui/components/quote-preview.ts tests/content/ui/components/quote-preview.test.ts src/content/ui/overlay-bar.ts
git commit -m "refactor: extract QuotePreview component from overlay bar"
```

---

### Task 4: Extract OriginatorLookup Component

**Files:**
- Create: `src/content/ui/components/originator-lookup.ts`
- Create: `tests/content/ui/components/originator-lookup.test.ts`
- Modify: `src/content/ui/overlay-bar.ts` — replace `lookupOriginator`, `checkDuplicateWithPreload`, move originator cache

**Step 1: Write the failing test**

Create `tests/content/ui/components/originator-lookup.test.ts`. Test cases:
- Returns cached result without API call
- Renders found originator with name and handle
- Renders not-found with create link
- Renders error state
- Uses preloaded data when fresh
- Falls back to API when preloaded data is stale

The component needs a `MessageSender` type for making API calls (injected by OverlayBar). Mock it in tests.

```typescript
type MessageSender = (message: { type: string; data?: unknown }) => Promise<Record<string, unknown>>;
```

**Step 2: Run test to verify it fails**

**Step 3: Implement OriginatorLookup**

Extract from overlay-bar.ts:
- `lookupOriginator()` (lines 650-771) — the core lookup logic
- `checkDuplicateWithPreload()` (lines 776-795) — preload checking
- `originatorCache` (line 15) — the module-level Map
- `updateOriginatorInfo()` (lines 879-884) — DOM rendering

The component's `lookup()` method returns a `LookupOutcome`:

```typescript
interface LookupOutcome {
  status: 'found' | 'not_found' | 'error';
  originator?: OriginatorSearchResult;
  createUrl?: string;
  errorMessage?: string;
}
```

OverlayBar uses the outcome to update CaptureState and trigger duplicate checking.

**Step 4: Run test, verify pass**

**Step 5: Wire into OverlayBar**

**Step 6: Run full test suite and type check**

**Step 7: Commit**

```bash
git add src/content/ui/components/originator-lookup.ts tests/content/ui/components/originator-lookup.test.ts src/content/ui/overlay-bar.ts
git commit -m "refactor: extract OriginatorLookup component from overlay bar"
```

---

### Task 5: Extract ActionButton Component

**Files:**
- Create: `src/content/ui/components/action-button.ts`
- Create: `tests/content/ui/components/action-button.test.ts`
- Modify: `src/content/ui/overlay-bar.ts` — replace `updateActionButton`, `updateSubmitButton`, `updateSubmitButtonWarning`

**Step 1: Write the failing test**

Test cases:
- Shows disabled submit button by default
- Enables submit button
- Shows warning-style submit button
- Shows login button when unauthenticated
- Calls onSubmit callback when submit clicked
- Calls onLogin callback when login clicked
- Shows "Submitting..." disabled state
- Shows "Done!" state
- Shows "Retry" after error

**Step 2: Run test to verify it fails**

**Step 3: Implement ActionButton**

Extract from overlay-bar.ts:
- `updateActionButton()` (lines 924-991) — login vs submit button creation
- `updateSubmitButton()` (lines 886-902) — submit button state
- `updateSubmitButtonWarning()` (lines 907-918) — warning variant

**Step 4: Run test, verify pass**

**Step 5: Wire into OverlayBar**

**Step 6: Run full test suite and type check**

**Step 7: Commit**

```bash
git add src/content/ui/components/action-button.ts tests/content/ui/components/action-button.test.ts src/content/ui/overlay-bar.ts
git commit -m "refactor: extract ActionButton component from overlay bar"
```

---

### Task 6: Final Cleanup and Verification

**Files:**
- Modify: `src/content/ui/overlay-bar.ts` — review final state
- Modify: `CLAUDE.md` — update directory structure

**Step 1: Verify overlay-bar.ts is ~300-400 lines**

If it's still large, check for remaining inline rendering that should be in components.

**Step 2: Run full verification**

```bash
bun run type-check
bun run lint
bun run test
bun run build
```

All must pass.

**Step 3: Update CLAUDE.md directory structure**

Update the directory structure section to reflect:
- Removal of `src/popup/`, `src/duplicate/`, `src/search/`, `src/lookup/`
- Addition of `src/content/ui/components/`
- Note that popup is fully removed (not just disabled)

**Step 4: Commit**

```bash
git add CLAUDE.md src/content/ui/overlay-bar.ts
git commit -m "chore: finalize overlay bar refactoring, update docs"
```
