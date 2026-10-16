import type { BrowseRequest, Page } from '../shared/types';
import { mergeBrowsePage, type BrowsePaginationProgress } from './browsePagination';

/** Refresh the loaded prefix atomically so a confirmed write cannot shrink it to page one. */
export async function refreshFavorites(
  read: (request: BrowseRequest) => Promise<Page>,
  request: BrowseRequest,
  pages: number,
  current: () => boolean,
) {
  let data: Page | undefined;
  let progress: BrowsePaginationProgress | undefined;
  for (let page = 1; page <= pages; page++) {
    if (!current()) return undefined;
    const incoming = await read({ ...request, kind: 'favorites', page, cursor: undefined, refresh: page === 1 });
    if (!current()) return undefined;
    const merged = mergeBrowsePage('favorites', data, incoming, progress);
    data = merged.data;
    progress = merged.progress;
    if (!data.hasMore || page === pages) return { data, progress, page };
  }
  return undefined;
}
