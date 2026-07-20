import type { Collection, DuplicateCheckResult } from '../../../src/types/api';
import {
  describeSelection,
  partitionMembership,
  seedSelection,
  summarizeAdds,
} from '../../../src/content/ui/components/collection-seed';

const collections: Collection[] = [
  collection('favorites', 'Favorites'),
  collection('research', 'Research'),
  collection('archive', 'Archive'),
];

describe('collection-seed helpers', () => {
  describe('seedSelection', () => {
    it('uses the remembered last-used set before the default when auto-add is on', () => {
      expect([...seedSelection(['research', 'missing', 'favorites'], 'archive', true, collections)])
        .toEqual(['research', 'favorites']);
    });

    it('falls back to the default slug when there is no remembered set and auto-add is on', () => {
      expect([...seedSelection([], 'archive', true, collections)]).toEqual(['archive']);
    });

    it('returns a blank staged set when auto-add is off', () => {
      expect([...seedSelection(['research'], 'archive', false, collections)]).toEqual([]);
    });
  });

  describe('partitionMembership', () => {
    it('separates already-member collections from addable collections by slug', () => {
      const match = duplicateMatch([
        { slug: 'favorites', name: 'Favorites' },
        { slug: 'deleted', name: 'Deleted collection' },
      ]);

      expect(partitionMembership(match, collections)).toEqual({
        alreadyIn: [{ slug: 'favorites', name: 'Favorites' }],
        addable: [collections[1], collections[2]],
      });
    });

    it('does not guess membership by id or name when the slug differs', () => {
      const match = duplicateMatch([
        { slug: 'id-research', name: 'Research' },
        { slug: 'missing-slug', name: 'Archive' },
      ]);

      expect(partitionMembership(match, collections)).toEqual({
        alreadyIn: [],
        addable: collections,
      });
    });
  });

  describe('describeSelection', () => {
    it('is blank when nothing is selected', () => {
      expect(describeSelection([])).toBe('');
    });

    it('keeps a single collection inline', () => {
      expect(describeSelection(['Favorites'])).toBe('Adding to: Favorites');
    });

    it('enumerates two or more collections one per line', () => {
      expect(describeSelection(['Favorites', 'Research']))
        .toBe('Adding to:\nFavorites\nResearch');
      expect(describeSelection(['Favorites', 'Research', 'Archive', 'Inbox']))
        .toBe('Adding to:\nFavorites\nResearch\nArchive\nInbox');
    });
  });

  describe('summarizeAdds', () => {
    it('splits successful and failed collection add results', () => {
      expect(summarizeAdds([
        { collectionSlug: 'favorites', collectionName: 'Favorites', success: true },
        { collectionSlug: 'research', collectionName: 'Research', success: false, error: 'Offline' },
      ])).toEqual({
        succeeded: [{ collectionSlug: 'favorites', collectionName: 'Favorites', success: true }],
        failed: [{ collectionSlug: 'research', collectionName: 'Research', success: false, error: 'Offline' }],
      });
    });
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

function duplicateMatch(member_collections: DuplicateCheckResult['matches'][number]['member_collections']): DuplicateCheckResult['matches'][number] {
  return {
    quote_id: 'quote-1',
    version_id: 1,
    text: 'Known quote',
    similarity: 1,
    match_type: 'exact',
    in_user_collections: member_collections.length > 0,
    member_collections,
    originator: {
      id: '1',
      full_name: 'Originator',
      sort_name: null,
      birth_year: null,
      death_year: null,
    },
    workflow_status: 'approved',
    likes_count: 0,
  };
}
