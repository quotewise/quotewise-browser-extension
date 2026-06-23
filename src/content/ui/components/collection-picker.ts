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
    this.renderLoading();
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
    this.container.innerHTML = `
      <div class="collection-picker" aria-live="polite">
        <span class="collection-picker-status">Loading collections...</span>
      </div>
    `;
  }

  private renderError(): void {
    this.container.innerHTML = '';
    const wrapper = this.createWrapper();
    const status = document.createElement('span');
    status.className = 'collection-picker-status';
    status.textContent = "Couldn't load your collections.";
    wrapper.appendChild(status);
    wrapper.appendChild(this.createRefreshButton());
    this.container.appendChild(wrapper);
  }

  private renderReady(): void {
    this.container.innerHTML = '';
    const wrapper = this.createWrapper();

    const header = document.createElement('div');
    header.className = 'collection-picker-header';
    const label = document.createElement('span');
    label.className = 'collection-picker-label';
    label.textContent = this.label;
    header.appendChild(label);
    header.appendChild(this.createRefreshButton());
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

    for (const collection of this.available) {
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

  private createRefreshButton(): HTMLButtonElement {
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'collection-picker-refresh';
    refresh.textContent = 'Refresh';
    refresh.setAttribute('aria-label', 'Refresh collections');
    refresh.addEventListener('click', () => {
      void this.refresh();
    });
    return refresh;
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

    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  private emitSelectionChange(): void {
    this.options.onSelectionChange?.(new Set(this.selected), this.getAvailableCollections());
  }
}
