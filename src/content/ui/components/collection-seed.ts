import type { Collection, DuplicateCheckResult, MemberCollection } from '../../../types/api';

export interface CollectionAddOutcome {
  collectionSlug: string;
  collectionName: string;
  success: boolean;
  alreadyMember?: boolean;
  error?: string;
}

export interface CollectionAddSummary {
  succeeded: CollectionAddOutcome[];
  failed: CollectionAddOutcome[];
}

export function seedSelection(
  lastUsedSlugs: string[],
  defaultSlug: string | null,
  autoAddOn: boolean,
  available: Collection[],
): Set<string> {
  const availableSlugs = new Set(available.map(collection => collection.slug));
  const selected = new Set<string>();

  if (!autoAddOn) {
    return selected;
  }

  for (const slug of lastUsedSlugs) {
    if (availableSlugs.has(slug)) {
      selected.add(slug);
    }
  }

  if (selected.size > 0) {
    return selected;
  }

  if (defaultSlug && availableSlugs.has(defaultSlug)) {
    selected.add(defaultSlug);
  }

  return selected;
}

export function partitionMembership(
  match: Pick<DuplicateCheckResult['matches'][number], 'member_collections'>,
  allCollections: Collection[],
): { alreadyIn: MemberCollection[]; addable: Collection[] } {
  const availableSlugs = new Set(allCollections.map(collection => collection.slug));
  const alreadyIn = match.member_collections.filter(collection => availableSlugs.has(collection.slug));
  const alreadySlugs = new Set(alreadyIn.map(collection => collection.slug));

  return {
    alreadyIn,
    addable: allCollections.filter(collection => !alreadySlugs.has(collection.slug)),
  };
}

export function summarizeAdds(results: CollectionAddOutcome[]): CollectionAddSummary {
  return {
    succeeded: results.filter(result => result.success),
    failed: results.filter(result => !result.success),
  };
}
