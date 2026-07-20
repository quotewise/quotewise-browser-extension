import type { Collection, MemberCollection } from '../../../types/api';
import { partitionMembership } from './collection-seed';

interface CollectionPickerOptions {
  loadCollections: (forceRefresh?: boolean) => Promise<Collection[]>;
  initialSelectedSlugs?: Iterable<string>;
  alreadyIn?: MemberCollection[];
  label?: string;
  onSelectionChange?: (selected: Set<string>, available: Collection[]) => void;
}

export class CollectionPicker {
  private available: Collection[] = [];
  private selected = new Set<string>();
  private alreadyIn: MemberCollection[];
  private label: string;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: CollectionPickerOptions,
  ) {
    this.selected = new Set(options.initialSelectedSlugs || []);
    this.alreadyIn = options.alreadyIn || [];
    this.label = options.label || 'Collections';
  }

  async mount(): Promise<void> {
    await this.load(false);
  }

  /**
   * Mounts are fire-and-forget, so a superseded picker's load can resolve after
   * its replacement has rendered. Disposing makes every later render a no-op,
   * preventing the stale instance from overwriting the live one.
   */
  dispose(): void {
    this.disposed = true;
  }

  async refresh(): Promise<void> {
    await this.load(true);
  }

  getSelectedSlugs(): Set<string> {
    return new Set(this.selected);
  }

  getSelectedCollections(): Collection[] {
    return this.available.filter(collection => this.selected.has(collection.slug));
  }

  getAvailableCollections(): Collection[] {
    return [...this.available];
  }

  setSelectedSlugs(slugs: Iterable<string>): void {
    this.selected = new Set(slugs);
    this.reconcileSelection();
    this.renderReady();
    this.emitSelectionChange();
  }

  setAlreadyIn(alreadyIn: MemberCollection[]): void {
    this.alreadyIn = alreadyIn;
    this.reconcileSelection();
    this.renderReady();
    this.emitSelectionChange();
  }

  private async load(forceRefresh: boolean): Promise<void> {
    // Keep an already-rendered list on screen while refreshing — flashing
    // "Loading collections…" over a usable list is churn, not information.
    if (!this.container.firstChild) this.renderLoading();
    try {
      const collections = await this.options.loadCollections(forceRefresh);
      this.available = partitionMembership({ member_collections: this.alreadyIn }, collections).addable;
      this.reconcileSelection();
      this.renderReady();
      this.emitSelectionChange();
    } catch {
      this.renderError();
    }
  }

  private reconcileSelection(): void {
    const validSlugs = new Set(this.available.map(collection => collection.slug));
    this.selected = new Set([...this.selected].filter(slug => validSlugs.has(slug)));
  }

  private renderLoading(): void {
    if (this.disposed) return;
    this.container.innerHTML = `
      <div class="collection-picker" aria-live="polite">
        <span class="collection-picker-status">Loading collections...</span>
      </div>
    `;
  }

  private renderError(): void {
    if (this.disposed) return;
    this.container.innerHTML = '';
    const wrapper = this.createWrapper();
    const status = document.createElement('span');
    status.className = 'collection-picker-status';
    status.textContent = "Couldn't load your collections. Use Refresh above.";
    wrapper.appendChild(status);
    this.container.appendChild(wrapper);
  }

  private renderReady(): void {
    if (this.disposed) return;
    this.container.innerHTML = '';
    const wrapper = this.createWrapper();

    const header = document.createElement('div');
    header.className = 'collection-picker-header';
    const label = document.createElement('span');
    label.className = 'collection-picker-label';
    label.textContent = this.label;
    header.appendChild(label);
    wrapper.appendChild(header);

    if (this.alreadyIn.length > 0) {
      const already = document.createElement('div');
      already.className = 'collection-picker-already';
      already.textContent = `✓ Already in: ${this.alreadyIn.map(collection => collection.name).join(', ')}`;
      wrapper.appendChild(already);
    }

    if (this.available.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'collection-picker-empty';
      empty.textContent = this.alreadyIn.length > 0
        ? 'No additional collections available.'
        : 'No collections yet. Create one in the Quotewise web app.';
      wrapper.appendChild(empty);
      this.container.appendChild(wrapper);
      return;
    }

    const list = document.createElement('div');
    list.className = 'collection-picker-list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', this.label);

    // Checked collections (seeded last-used/default) render first so they stay
    // visible at the top of the capped, scrollable list. Render-time only — the
    // checkbox change handler does not reorder, to avoid jarring reflow on click.
    const ordered = [
      ...this.available.filter(collection => this.selected.has(collection.slug)),
      ...this.available.filter(collection => !this.selected.has(collection.slug)),
    ];
    for (const collection of ordered) {
      list.appendChild(this.renderCollectionRow(collection));
    }

    wrapper.appendChild(list);
    this.container.appendChild(wrapper);
  }

  private createWrapper(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'collection-picker';
    return wrapper;
  }

  private renderCollectionRow(collection: Collection): HTMLElement {
    const label = document.createElement('label');
    label.className = 'collection-picker-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = collection.slug;
    input.checked = this.selected.has(collection.slug);
    input.setAttribute('aria-label', `Add to ${collection.name}`);
    input.addEventListener('change', () => {
      if (input.checked) {
        this.selected.add(collection.slug);
      } else {
        this.selected.delete(collection.slug);
      }
      this.emitSelectionChange();
    });

    const text = document.createElement('span');
    text.textContent = collection.name;
    text.title = collection.name;

    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  private emitSelectionChange(): void {
    this.options.onSelectionChange?.(new Set(this.selected), this.getAvailableCollections());
  }
}
