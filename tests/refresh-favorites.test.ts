import { describe, expect, it } from 'vitest';
import { refreshFavorites } from '../src/hooks/refreshFavorites';
import type { BrowseRequest, MediaItem, Page } from '../src/shared/types';

const item = (id: string): MediaItem => ({ id, source: 'bilibili', kind: 'video', title: id });
describe('refreshing an already loaded collection prefix', () => {
  it('keeps all loaded pages in source order with one request at a time', async () => {
    let active = 0, maximum = 0;
    const requests: BrowseRequest[] = [];
    const read = async (request: BrowseRequest): Promise<Page> => {
      requests.push(request);
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return { items: [item(String(request.page)), item('overlap')], hasMore: true };
    };
    const result = await refreshFavorites(read, { kind: 'favorites', id: 42 }, 3, () => true);
    expect(result?.data.items.map(item => item.id)).toEqual(['1', 'overlap', '2', '3']);
    expect(result?.page).toBe(3);
    expect(result?.data.hasMore).toBe(true);
    expect(maximum).toBe(1);
    expect(requests.map(request => [request.kind, request.id, request.page, request.refresh])).toEqual([
      ['favorites', 42, 1, true], ['favorites', 42, 2, false], ['favorites', 42, 3, false],
    ]);
  });
  it('stops at the actual last page and never publishes a failed partial prefix', async () => {
    const read = async (request: BrowseRequest): Promise<Page> => ({ items: [item(String(request.page))], hasMore: false });
    expect((await refreshFavorites(read, { kind: 'favorites' }, 5, () => true))?.page).toBe(1);
    await expect(refreshFavorites(async request => {
      if (request.page === 2) throw new Error('page two failed');
      return { items: [item('first')], hasMore: true };
    }, { kind: 'favorites' }, 3, () => true)).rejects.toThrow('page two failed');
  });
  it('cancels before the next request or completion when the feed changes', async () => {
    let current = true, calls = 0;
    const read = async (): Promise<Page> => {
      calls++;
      current = false;
      return { items: [item('late')], hasMore: true };
    };
    expect(await refreshFavorites(read, { kind: 'favorites' }, 4, () => current)).toBeUndefined();
    expect(calls).toBe(1);
    expect(await refreshFavorites(read, { kind: 'favorites' }, 4, () => false)).toBeUndefined();
    expect(calls).toBe(1);
  });
});
