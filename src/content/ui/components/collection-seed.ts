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
  const isMember = (collection: Collection, member: MemberCollection): boolean => (
    collection.slug === member.slug
  );

  const alreadyIn = match.member_collections.filter(member =>
    allCollections.some(collection => isMember(collection, member))
  );

  return {
    alreadyIn,
    addable: allCollections.filter(collection =>
      !alreadyIn.some(member => isMember(collection, member))
    ),
  };
}

export function summarizeAdds(results: CollectionAddOutcome[]): CollectionAddSummary {
  return {
    succeeded: results.filter(result => result.success),
    failed: results.filter(result => !result.success),
  };
}

/**
 * Summary of the collections a capture will be added to, shown under the
 * Submit button. One name stays inline; two or more enumerate one per line
 * (newline-separated) so the full list is inspectable and left-aligned instead
 * of ellipsis-clipped off the caption's right edge.
 */
export function describeSelection(names: string[]): string {
  if (names.length === 0) {
    return '';
  }
  if (names.length === 1) {
    return `Adding to: ${names[0]}`;
  }
  return `Adding to:\n${names.join('\n')}`;
}
