import type { BrowseKind, Page } from '../shared/types';

export interface BrowsePaginationProgress {
  emptyPages: number;
  cursors: Set<string>;
}

function appendUnique<T extends { id: string }>(previous: T[], incoming: T[]) {
  const ids = new Set(previous.map(item => item.id));
  return [...previous, ...incoming.filter(item => {
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  })];
}

/** Generic feeds return individual pages; recommendations own their cumulative state. */
export function mergeBrowsePage(
  kind: Exclude<BrowseKind, 'recommend'>,
  previous: Page | undefined,
  incoming: Page,
  progress?: BrowsePaginationProgress,
): { data: Page; progress: BrowsePaginationProgress } {
  const items = appendUnique(previous?.items || [], incoming.items);
  const dynamics = kind === 'dynamic'
    ? appendUnique(previous?.dynamics || [], incoming.dynamics || [])
    : incoming.dynamics;
  const previousCount = kind === 'dynamic' ? previous?.dynamics?.length || 0 : previous?.items.length || 0;
  const count = kind === 'dynamic' ? dynamics?.length || 0 : items.length;
  const emptyPages = count > previousCount ? 0 : (previous ? progress?.emptyPages || 0 : 0) + 1;
  const cursors = new Set(previous ? progress?.cursors : undefined);
  if (previous?.cursor) cursors.add(previous.cursor);
  const usesCursor = kind === 'history' || kind === 'dynamic';
  const repeatedCursor = usesCursor && !!incoming.cursor && cursors.has(incoming.cursor);
  if (incoming.cursor) cursors.add(incoming.cursor);
  return {
    data: { ...incoming, items, dynamics, hasMore: incoming.hasMore && emptyPages < 5 && !repeatedCursor },
    progress: { emptyPages, cursors },
  };
}
