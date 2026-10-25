import { describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { CompanionCatalog } from '../src/hooks/companion-catalog';
import { defaultPreferences, type Bootstrap, type MediaItem } from '../src/shared/types';

vi.mock('../src/api', () => ({ api: { bootstrap: vi.fn(), browse: vi.fn() } }));
const boot: Bootstrap = { account: { app: true, web: true, storage: 'memory' }, library: [], queue: [],
  history: [], preferences: defaultPreferences, version: 'test', platform: 'test' };
const item: MediaItem = { id: 'bili:history', source: 'bilibili', kind: 'video', title: '观看记录', aid: 42 };

describe('phone history sources', () => {
  it('reads platform history with its original cursor and service order', async () => {
    const catalog = new CompanionCatalog();
    vi.mocked(api.browse).mockResolvedValueOnce({ items: [item, { ...item, id: 'older', title: '旧记录' }], hasMore: true, cursor: 'next' });
    const reply = await catalog.browse({ kind: 'catalog', collection: 'history', cursor: 'opaque', page: 2 }, boot);
    expect(api.browse).toHaveBeenLastCalledWith({ kind: 'history', cursor: 'opaque', page: 2 });
    expect(reply.catalog?.items.map(item => item.title)).toEqual(['观看记录', '旧记录']);
    expect(reply.catalog?.cursor).toBe('next');
  });
  it('does not substitute local records for a missing platform authorization', async () => {
    const catalog = new CompanionCatalog();
    const browse = vi.mocked(api.browse); browse.mockClear();
    expect(await catalog.browse({ kind: 'catalog', collection: 'history' }, {
      ...boot, account: { ...boot.account, web: false },
    })).toEqual({ error: 'web-auth' });
    expect(browse).not.toHaveBeenCalled();
  });
  it('reads newly saved local history and preserves separate episode identities', async () => {
    const catalog = new CompanionCatalog();
    vi.mocked(api.bootstrap).mockResolvedValueOnce({ ...boot, history: [1, 2].map(cid => ({
      item, part: { id: `cid:${cid}`, cid, title: `第${cid}集` }, position: 10, duration: 100, updatedAt: 1,
    })) });
    const reply = await catalog.browse({ kind: 'catalog', collection: 'localHistory' }, boot);
    const cards = reply.catalog!.items;
    expect(cards).toHaveLength(2);
    expect(cards[0].handle).not.toBe(cards[1].handle);
    expect(cards.map(card => catalog.get(card.handle)?.cid)).toEqual([1, 2]);
    expect(JSON.stringify(reply)).not.toContain('cid:');
    expect(boot.history).toEqual([]);
  });
  it('rejects history completing after account handles were revoked', async () => {
    const catalog = new CompanionCatalog();
    let finish!: (value: Bootstrap) => void;
    vi.mocked(api.bootstrap).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const request = catalog.browse({ kind: 'catalog', collection: 'localHistory' }, boot);
    catalog.clear(); finish(boot);
    expect(await request).toEqual({ error: 'canceled' });
  });
});
