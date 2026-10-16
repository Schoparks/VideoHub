import { afterEach, describe, expect, it, vi } from 'vitest';
import { BilibiliAccount } from '../electron/accounts/bilibili-account';
import { Vault } from '../electron/accounts/vault';
import { BilibiliProvider } from '../electron/providers/bilibili';
import { recommendationParams } from '../electron/protocol/signing';

// Independent fixtures describe the observable default App recommendation contract
// at BewlyCat 9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa.
const card = (aid: number, idx: number, extra: Record<string, any> = {}) => ({
  card_type: 'small_cover_v2', goto: 'av', title: `video-${aid}`,
  args: { aid, up_name: `author-${aid}` }, bvid: `BV-fixture-${aid}`, idx,
  ...extra,
});
const response = (items: any[], code = 0) => new Response(JSON.stringify({ code, message: 'fixture response', data: { items } }), { headers: { 'content-type': 'application/json' } });
function harness(reply: (call: number) => Response | Promise<Response>) {
  const vault = new Vault('', { available: () => false, encrypt: Buffer.from, decrypt: value => value.toString() });
  vault.value = { accessToken: 'test-app-token', cookie: 'SESSDATA=test-web-session; DedeUserID=42' };
  const requests: { url: URL; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (input: any, init: RequestInit = {}) => {
    requests.push({ url: new URL(String(input)), init });
    return reply(requests.length);
  });
  return { provider: new BilibiliProvider(new BilibiliAccount(vault, fetcher as typeof fetch)), requests, fetcher };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('BewlyCat default App recommendation contract', () => {
  it('has exactly the eight effective parameters, including the runtime TV appkey and locales', () => {
    expect(recommendationParams('token')).toEqual({
      build: 74800100, device: 'pad', mobi_app: 'iphone',
      c_locate: 'zh-Hans_CN', s_locale: 'zh-Hans_CN', idx: 1,
      appkey: '4409e2ce8ffd12b8', access_key: 'token',
    });
  });

  it('sends cookies, desktop browser headers, no signature, and the 20-second request budget', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { provider, requests } = harness(() => response([card(1, 101)]));
    await provider.browse({ kind: 'recommend' });
    expect(requests).toHaveLength(1);
    const { url, init } = requests[0];
    expect(url.origin + url.pathname).toBe('https://app.bilibili.com/x/v2/feed/index');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      build: '74800100', device: 'pad', mobi_app: 'iphone',
      c_locate: 'zh-Hans_CN', s_locale: 'zh-Hans_CN', idx: '1',
      appkey: '4409e2ce8ffd12b8', access_key: 'test-app-token',
    });
    const headers = new Headers(init.headers);
    expect(headers.get('Cookie')).toBe('SESSDATA=test-web-session; DedeUserID=42');
    expect(headers.get('Referer')).toBe('https://www.bilibili.com/');
    expect(headers.get('User-Agent')).toContain('Mozilla/');
    expect(headers.get('User-Agent')).not.toContain('bili-universal');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(timeout).toHaveBeenCalledWith(20000);
  });

  it('takes the cursor from the last accepted item and leaves it there when later cards are filtered or duplicated', async () => {
    const { provider, requests } = harness(call => response(call === 1
      ? [card(1, 40), card(2, 41), card(3, 42, { card_type: 'banner_v8' }), card(4, 43, { card_type: 'cm_v1' }), card(1, 44)]
      : [card(5, 50), card(6, 90, { card_type: 'small_banner' })]));
    const first = await provider.browse({ kind: 'recommend' });
    expect(first.items.map(item => item.aid)).toEqual([1, 2]);
    expect(first.cursor).toBe('41');
    const next = await provider.browse({ kind: 'recommend', cursor: 'untrusted-client-cursor' });
    expect(requests[1].url.searchParams.get('idx')).toBe('41');
    expect(next.items.map(item => item.aid)).toEqual([1, 2, 5]);
    expect(next.cursor).toBe('50');
  });

  it('uses card_type and args.aid or bvid admission without inventing goto or ad flag exclusions', async () => {
    const { provider } = harness(() => response([
      card(1, 1, { card_type: 'banner_v8' }),
      card(2, 2, { card_type: 'cm_v1' }),
      card(3, 3, { args: undefined, bvid: undefined, aid: 3, param: '3', player_args: { aid: 3 } }),
      card(4, 4, { args: { aid: 0 }, bvid: ' ' }),
      card(5, 5, { goto: 'bangumi', ad_info: {}, banner_item: {}, is_ad: true, title: 'retained non-av', cover: 'http://i0.hdslb.com/fixture.jpg', player_args: { cid: 505, duration: 81 }, mask: { avatar: { text: 'display author' } }, desc: 'category · because', rcmd_reason: { content: 'unused reason' } }),
      card(6, 6, { args: undefined, title: 'bvid-only' }),
      card(7, 7, { bvid: undefined, title: 'aid-only' }),
    ]));
    const page = await provider.browse({ kind: 'recommend' });
    expect(page.items.map(item => item.title)).toEqual(['retained non-av', 'bvid-only', 'aid-only']);
    expect(page.items[0]).toMatchObject({ aid: 5, bvid: 'BV-fixture-5', cid: 505, duration: 81, author: 'display author', cover: 'https://i0.hdslb.com/fixture.jpg', badge: 'because' });
  });

  it('uses the upstream author and capsule fields instead of unrelated recommendation metadata', async () => {
    const { provider } = harness(() => response([
      card(1, 1, { mask: { avatar: { text: 'shown author' } }, desc: 'type · capsule', bottom_rcmd_reason: '已关注' }),
      card(2, 2, { bottom_rcmd_reason: '  已关注  ' }),
      card(3, 3, { bottom_rcmd_reason: '已關注' }),
      card(4, 4, { bottom_rcmd_reason: 'arbitrary reason', rcmd_reason: { content: 'another reason' } }),
    ]));
    const page = await provider.browse({ kind: 'recommend' });
    expect(page.items.map(item => item.author)).toEqual(['shown author', '', '', '']);
    expect(page.items.map(item => item.badge || '')).toEqual(['capsule', '已关注', '已關注', '']);
  });

  it('keeps the upstream equality semantics when either ID field is absent', async () => {
    const { provider } = harness(() => response([
      card(1, 10, { bvid: undefined }),
      card(2, 11, { bvid: undefined }),
      card(3, 12, { args: undefined }),
      card(4, 13, { args: undefined }),
    ]));
    const page = await provider.browse({ kind: 'recommend' });
    expect(page.items.map(item => item.title)).toEqual(['video-1', 'video-3']);
    expect(page.cursor).toBe('12');
  });

  it('resets items, duplicate state and cursor on refresh', async () => {
    const { provider, requests } = harness(call => response(call === 1 ? [card(1, 50), card(2, 51)] : [card(2, 60, { title: 'fresh' })]));
    await provider.browse({ kind: 'recommend' });
    const page = await provider.browse({ kind: 'recommend', refresh: true, cursor: '51' });
    expect(requests[1].url.searchParams.get('idx')).toBe('1');
    expect(page.items.map(item => item.title)).toEqual(['fresh']);
    expect(page.cursor).toBe('60');
  });

  it.each(['empty', 'exception', 'business-error'] as const)('retries %s responses at 250ms and 500ms, stopping at three attempts', async failure => {
    vi.useFakeTimers();
    const { provider, requests } = harness(() => {
      if (failure === 'exception') throw new Error('offline');
      return response([], failure === 'business-error' ? -500 : 0);
    });
    const rejected = expect(provider.browse({ kind: 'recommend' })).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(requests).toHaveLength(3);
    expect(requests.map(req => req.url.searchParams.get('idx'))).toEqual(['1', '1', '1']);
  });

  it('accepts a successful retry without reordering its cards', async () => {
    vi.useFakeTimers();
    const { provider, requests } = harness(call => call < 3 ? response([]) : response([card(2, 51), card(1, 52)]));
    const pending = provider.browse({ kind: 'recommend' });
    await vi.advanceTimersByTimeAsync(750);
    const page = await pending;
    expect(requests).toHaveLength(3);
    expect(page.items.map(item => item.aid)).toEqual([2, 1]);
  });

  it('does not retry when a failed attempt has already consumed the five-second retry window', async () => {
    vi.useFakeTimers();
    const { provider, requests } = harness(async () => {
      await new Promise(resolve => setTimeout(resolve, 5001));
      return response([]);
    });
    const rejected = expect(provider.browse({ kind: 'recommend' })).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    expect(requests).toHaveLength(1);
  });

  it('treats code 62011 as requiring authorization without retries or fallback', async () => {
    vi.useFakeTimers();
    const { provider, requests } = harness(() => response([], 62011));
    await expect(provider.browse({ kind: 'recommend' })).rejects.toMatchObject({ code: 62011 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(1);
  });

  it('clears the old recommendation list even when a refresh fails', async () => {
    vi.useFakeTimers();
    let failing = false;
    const { provider, requests } = harness(() => failing ? response([], 62011) : response([card(1, 100)]));
    await provider.browse({ kind: 'recommend' });
    failing = true;
    await expect(provider.browse({ kind: 'recommend', refresh: true })).rejects.toThrow();
    failing = false;
    const page = await provider.browse({ kind: 'recommend' });
    expect(requests).toHaveLength(3);
    expect(requests[2].url.searchParams.get('idx')).toBe('1');
    expect(page.items).toHaveLength(1);
  });

  it('stops after five consecutive batches add no cards, and refresh resets that limit', async () => {
    const { provider, requests } = harness(() => response([card(1, 10)]));
    let page = await provider.browse({ kind: 'recommend' });
    for (let emptyBatch = 1; emptyBatch <= 5; emptyBatch++) {
      page = await provider.browse({ kind: 'recommend', cursor: page.cursor });
      expect(page.items).toHaveLength(1);
      expect(page.hasMore).toBe(emptyBatch < 5);
    }
    expect(requests).toHaveLength(6);
    expect((await provider.browse({ kind: 'recommend', cursor: page.cursor })).hasMore).toBe(false);
    expect(requests).toHaveLength(6);
    expect((await provider.browse({ kind: 'recommend', refresh: true })).hasMore).toBe(true);
    expect(requests).toHaveLength(7);
  });

  it('resets the consecutive empty-batch counter when a batch adds a card', async () => {
    const { provider } = harness(call => response(call < 6 ? [card(1, 10)] : [card(2, 20)]));
    let page = await provider.browse({ kind: 'recommend' });
    for (let batch = 0; batch < 4; batch++) page = await provider.browse({ kind: 'recommend', cursor: page.cursor });
    expect(page.hasMore).toBe(true);
    page = await provider.browse({ kind: 'recommend', cursor: page.cursor });
    expect(page.items).toHaveLength(2);
    for (let batch = 0; batch < 4; batch++) page = await provider.browse({ kind: 'recommend', cursor: page.cursor });
    expect(page.hasMore).toBe(true);
    expect((await provider.browse({ kind: 'recommend', cursor: page.cursor })).hasMore).toBe(false);
  });
});
