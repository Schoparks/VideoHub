import type { BrowseRequest, MediaItem, Page, SearchType } from '../../src/shared/types';
import { normalizeSeason } from './bilibili-pgc';
import { normalizeLive } from './bilibili-live';
import { bilibiliList } from './bilibili-list-response';

type Category = Exclude<SearchType, 'all'>;
interface SearchResult { result?: unknown[]; numPages?: number; numResults?: number; v_voucher?: string }
type Search = (params: Record<string, string | number>) => Promise<SearchResult>;
const categories: Category[] = ['media_bangumi', 'media_ft', 'video', 'live_room'];

function pendingCategories(request: BrowseRequest, page: number): Category[] {
  if (request.searchType && request.searchType !== 'all') return [request.searchType];
  if (!request.cursor || request.refresh || page === 1) return categories;
  try {
    const cursor = JSON.parse(request.cursor);
    if (cursor.page !== page - 1 || !Array.isArray(cursor.types)
      || !cursor.types.every((type: Category) => categories.includes(type))) throw new Error();
    return categories.filter(type => cursor.types.includes(type));
  } catch {
    throw new Error('搜索分页已失效，请重新搜索');
  }
}

export async function searchBilibili(
  request: BrowseRequest,
  search: Search,
  normalizeVideo: (value: any) => MediaItem,
): Promise<Page> {
  const keyword = request.keyword?.trim();
  if (!keyword) return { items: [], hasMore: false };
  const page = request.refresh ? 1 : request.page || 1;
  const types = pendingCategories(request, page);
  const items: MediaItem[] = [];
  const pending: Category[] = [];
  // Fetch independent categories together; merge in category/service order, not arrival order.
  // A failed category still rejects the page and remains retryable.
  const results = await Promise.all(types.map(type => search({ search_type: type, keyword, page, page_size: 24 })));
  for (const [index, type] of types.entries()) {
    const result = results[index];
    const normalize = type === 'video' ? normalizeVideo : type === 'live_room' ? normalizeLive : normalizeSeason;
    const normalized = bilibiliList(result, 'result', '搜索', page, 'numResults').map(normalize);
    items.push(...normalized);
    if (page < Number(result.numPages)) pending.push(type);
  }
  const seen = new Set<string>();
  return {
    items: items.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
    hasMore: pending.length > 0,
    cursor: JSON.stringify({ page, types: pending }),
  };
}
