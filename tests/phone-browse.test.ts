import { describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { CompanionCatalog } from '../src/hooks/companion-catalog';
import { companionReply } from '../src/shared/companion-schema';
import { defaultPreferences, type Bootstrap, type DynamicItem } from '../src/shared/types';

vi.mock('../src/api', () => ({ api: { browse: vi.fn() } }));
const boot: Bootstrap = { account: { app: true, web: true, storage: 'memory' }, library: [], queue: [],
  history: [], preferences: defaultPreferences, version: 'test', platform: 'test' };

describe('phone desktop browse parity', () => {
  it('forwards section filters, pagination and platform order without creating a new recommendation rule', async () => {
    const catalog = new CompanionCatalog();
    for (const collection of ['regions', 'cinema', 'followingCinema', 'dynamic'] as const) {
      vi.mocked(api.browse).mockResolvedValueOnce({ items: [], hasMore: true, cursor: 'next' });
      const result = await catalog.browse({ kind: 'catalog', collection, category: 2, dynamicType: 'video', page: 3, cursor: 'cursor' }, boot);
      expect(api.browse).toHaveBeenLastCalledWith({ kind: collection, id: 2, dynamicType: 'video', page: 3, cursor: 'cursor' });
      expect(result.catalog).toMatchObject({ hasMore: true, cursor: 'next' });
    }
  });
  it('requires the existing web account for follows and dynamics', async () => {
    vi.mocked(api.browse).mockClear();
    const catalog = new CompanionCatalog();
    for (const collection of ['dynamic', 'followingCinema'] as const) {
      expect(await catalog.browse({ kind: 'catalog', collection }, { ...boot, account: { ...boot.account, web: false } })).toEqual({ error: 'web-auth' });
    }
    expect(api.browse).not.toHaveBeenCalled();
  });
  it('keeps full dynamic text, reposts and playable videos while hiding platform and image addresses', () => {
    const catalog = new CompanionCatalog();
    const entry: DynamicItem = { id: 'private-id', author: '作者', text: '正文\n'.repeat(1000), images: ['https://i0.hdslb.com/bfs/archive/a.jpg'], url: 'https://t.bilibili.com/private-id',
      original: { id: 'original-id', author: '原作者', text: '转发内容', images: [], url: 'https://t.bilibili.com/original-id',
        video: { id: 'private-video', source: 'bilibili', kind: 'video', title: '原视频', aid: 123 } } };
    const result = catalog.present({ items: [], dynamics: [entry], hasMore: false });
    expect(companionReply.safeParse(result).success).toBe(true);
    const dynamic = result.catalog!.dynamics![0];
    expect(dynamic.blocks[0].text).toBe(entry.text);
    expect(dynamic.blocks[1].text).toBe('转发内容');
    expect(catalog.get(dynamic.blocks[0].images[0])).toBeUndefined();
    expect(catalog.get(dynamic.blocks[1].video!.handle)?.aid).toBe(123);
    expect(JSON.stringify(result)).not.toMatch(/private-|https:|original-id/);
    expect(catalog.present({ items: [], dynamics: [entry], hasMore: false }).catalog!.dynamics![0].handle).toBe(dynamic.handle);
    catalog.clear();
    expect(catalog.get(dynamic.blocks[1].video!.handle)).toBeUndefined();
  });
});
