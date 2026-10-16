import { describe, expect, it } from 'vitest';
import { BilibiliAccount } from '../electron/accounts/bilibili-account';
import { Vault } from '../electron/accounts/vault';
import { BilibiliProvider } from '../electron/providers/bilibili';
import { schemas } from '../electron/ipc';
import type { SearchType } from '../src/shared/types';
import { searchBilibili } from '../electron/providers/bilibili-search';
import { normalizeVideo } from '../electron/providers/bilibili';

const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, data }));
// Synthetic response shapes: these tests do not assert real availability or account rights.
const season = { season_id: 42, media_id: 999, title: '<em>黑袍纠察队</em>', cover: '//i0.hdslb.com/cover.jpg' };
const video = { aid: 170001, bvid: 'BV17x411w7KC', title: '<em>黑袍纠察队</em>讨论' };

function fixture(result: (type: string, page: number) => Response) {
  const requests: URL[] = [];
  const vault = new Vault('', { available: () => false, encrypt: Buffer.from, decrypt: value => value.toString() });
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/nav')) return response({
      wbi_img: {
        img_url: `https://i0.hdslb.com/${'a'.repeat(32)}.png`,
        sub_url: `https://i0.hdslb.com/${'b'.repeat(32)}.png`,
      },
    });
    requests.push(url);
    return result(url.searchParams.get('search_type')!, Number(url.searchParams.get('page')));
  };
  return { provider: new BilibiliProvider(new BilibiliAccount(vault, fetcher)), requests };
}

describe('Bilibili video, bangumi and film search', () => {
  it('starts all categories before any completes and keeps films ahead of faster video results', async () => {
    const pending = new Map<string, (value: { result: unknown[]; numPages: number }) => void>();
    const job = searchBilibili({ kind: 'search', keyword: '黑袍纠察队' }, params => new Promise(resolve => {
      pending.set(String(params.search_type), resolve);
    }), normalizeVideo);
    expect([...pending.keys()]).toEqual(['media_bangumi', 'media_ft', 'video', 'live_room']);
    pending.get('video')!({ result: [video], numPages: 2 });
    pending.get('live_room')!({ result: [], numPages: 0 });
    pending.get('media_ft')!({ result: [season], numPages: 1 });
    pending.get('media_bangumi')!({ result: [], numPages: 0 });
    const result = await job;
    expect(result.items.map(item => item.kind)).toEqual(['season', 'video']);
    expect(JSON.parse(result.cursor!).types).toEqual(['video']);
  });

  it('includes playable season references in default search rather than only ordinary videos', async () => {
    const { provider, requests } = fixture(type => response({
      result: type === 'media_ft' ? [season] : type === 'video' ? [video] : [], numPages: 1,
    }));
    const result = await provider.browse({ kind: 'search', keyword: '黑袍纠察队' });
    expect(requests.map(url => url.searchParams.get('search_type'))).toEqual(['media_bangumi', 'media_ft', 'video', 'live_room']);
    expect(requests.every(url => url.searchParams.get('keyword') === '黑袍纠察队')).toBe(true);
    expect(result.items[0]).toMatchObject({
      id: 'season:42', kind: 'season', seasonId: 42, title: '黑袍纠察队', cover: 'https://i0.hdslb.com/cover.jpg',
    });
    expect(result.items[1]).toMatchObject({ kind: 'video', bvid: video.bvid });
    for (const item of result.items) expect(schemas.resolve.safeParse([item]).success).toBe(true);
    expect(result.hasMore).toBe(false);
  });

  it.each<SearchType>(['video', 'media_bangumi', 'media_ft', 'live_room'])('queries only the selected %s category', async searchType => {
    const { provider, requests } = fixture(type => response({ result: type === 'video' ? [video] : type === 'live_room' ? [{ roomid: 42, title: '直播', live_status: 1 }] : [season], numPages: 3 }));
    const result = await provider.browse({ kind: 'search', keyword: '影视', searchType, page: 2 });
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('search_type')).toBe(searchType);
    expect(requests[0].searchParams.get('page')).toBe('2');
    expect(result.hasMore).toBe(true);
  });

  it('continues only categories with more results and resets all categories on refresh', async () => {
    const { provider, requests } = fixture((type, page) => response({
      result: type === 'video' ? [{ ...video, aid: page }] : type === 'live_room' ? [] : [season],
      numPages: type === 'video' ? 2 : 1,
    }));
    const first = await provider.browse({ kind: 'search', keyword: '影视', searchType: 'all' });
    expect(first.items.filter(item => item.kind === 'season')).toHaveLength(1);
    const next = await provider.browse({ kind: 'search', keyword: '影视', cursor: first.cursor, page: 2 });
    expect(next.items).toHaveLength(1);
    expect(next.hasMore).toBe(false);
    expect(requests.slice(4).map(url => url.searchParams.get('search_type'))).toEqual(['video']);
    await provider.browse({ kind: 'search', keyword: '影视', cursor: next.cursor, page: 3, refresh: true });
    expect(requests.slice(5).map(url => url.searchParams.get('page'))).toEqual(['1', '1', '1', '1']);
  });

  it('keeps a category failure visible and allows retrying the same page', async () => {
    let fail = true;
    const { provider } = fixture(type => type === 'media_ft' && fail
      ? response(null, -412) : response({ result: type === 'video' ? [video] : [season], numPages: 1 }));
    const request = { kind: 'search' as const, keyword: '影视' };
    await expect(provider.browse(request)).rejects.toThrow('风控');
    fail = false;
    expect((await provider.browse(request)).items).toHaveLength(3);
  });

  it('does not request blank keywords or accept unknown search categories through IPC', async () => {
    const { provider, requests } = fixture(() => response({}));
    expect(await provider.browse({ kind: 'search', keyword: ' ' })).toEqual({ items: [], hasMore: false });
    expect(requests).toEqual([]);
    expect(schemas.browse.safeParse([{ kind: 'search', searchType: 'media_ft' }]).success).toBe(true);
    expect(schemas.browse.safeParse([{ kind: 'search', searchType: 'arbitrary' }]).success).toBe(false);
  });
});
