import { CollectionPicker } from '../../../src/content/ui/components/collection-picker';
import type { Collection } from '../../../src/types/api';

describe('CollectionPicker', () => {
  let container: HTMLElement;
  let loadCollections: jest.Mock<Promise<Collection[]>, [boolean?]>;
  let onSelectionChange: jest.Mock;

  beforeEach(() => {
    container = document.createElement('div');
    loadCollections = jest.fn().mockResolvedValue([
      collection('favorites', 'Favorites'),
      collection('research', 'Research'),
    ]);
    onSelectionChange = jest.fn();
  });

  it('renders a multi-select checklist with staged selection and ARIA labels', async () => {
    const picker = new CollectionPicker(container, {
      loadCollections,
      initialSelectedSlugs: ['favorites'],
      onSelectionChange,
    });

    await picker.mount();

    expect(loadCollections).toHaveBeenCalledWith(false);
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label'))
      .toBe('Collections');
    const favorites = container.querySelector('input[value="favorites"]') as HTMLInputElement;
    const research = container.querySelector('input[value="research"]') as HTMLInputElement;
    expect(favorites.checked).toBe(true);
    expect(research.checked).toBe(false);

    research.checked = true;
    research.dispatchEvent(new Event('change', { bubbles: true }));

    expect([...picker.getSelectedSlugs()]).toEqual(['favorites', 'research']);
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      new Set(['favorites', 'research']),
      expect.arrayContaining([expect.objectContaining({ slug: 'research' })]),
    );
  });

  it('shows an honest empty state when there are no collections', async () => {
    loadCollections.mockResolvedValue([]);
    const picker = new CollectionPicker(container, { loadCollections });

    await picker.mount();

    expect(container.textContent).toContain('Create one in the Quotewise web app');
  });

  it('force-refreshes and reconciles staged selections against the refreshed list', async () => {
    loadCollections
      .mockResolvedValueOnce([
        collection('favorites', 'Favorites'),
        collection('research', 'Research'),
      ])
      .mockResolvedValueOnce([
        collection('research', 'Research'),
        collection('archive', 'Archive'),
      ]);
    const picker = new CollectionPicker(container, {
      loadCollections,
      initialSelectedSlugs: ['favorites', 'research'],
    });

    await picker.mount();
    (container.querySelector('.collection-picker-refresh') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(loadCollections).toHaveBeenLastCalledWith(true);
    expect([...picker.getSelectedSlugs()]).toEqual(['research']);
    expect(container.querySelector('input[value="favorites"]')).toBeNull();
    expect(container.querySelector('input[value="archive"]')).not.toBeNull();
  });

  it('renders read-only already-member collections separately from addable choices', async () => {
    const picker = new CollectionPicker(container, {
      loadCollections,
      alreadyIn: [{ slug: 'favorites', name: 'Favorites' }],
    });

    await picker.mount();

    expect(container.textContent).toContain('Already in: Favorites');
    expect(container.querySelector('input[value="favorites"]')).toBeNull();
    expect(container.querySelector('input[value="research"]')).not.toBeNull();
  });
});

function collection(slug: string, name: string): Collection {
  return {
    id: `id-${slug}`,
    slug,
    name,
    description: '',
    is_default: false,
    quote_count: 0,
    created_at: '2026-06-22T00:00:00Z',
    updated_at: '2026-06-22T00:00:00Z',
  };
}
