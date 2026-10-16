import { describe, expect, it } from 'vitest';
import { BilibiliAccount } from '../electron/accounts/bilibili-account';
import { Vault } from '../electron/accounts/vault';
import { BilibiliProvider, normalizeDynamic, normalizeVideo } from '../electron/providers/bilibili';
import { PlaybackSessions } from '../electron/playback/session';
import type { Store } from '../electron/storage/store';
import type { MediaGateway } from '../electron/playback/gateway';

const item = { id: 'bili:42', source: 'bilibili' as const, kind: 'video' as const, title: '旧标题', aid: 42 };
const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, data }));
const keys = { wbi_img: { img_url: `https://i0.hdslb.com/${'a'.repeat(32)}.png`, sub_url: `https://i0.hdslb.com/${'b'.repeat(32)}.png` } };

function fixture() {
  const pending = new Map<string, (value: Response) => void>();
  const calls: URL[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith('/playurl')) return response({ quality: 80, durl: [{ url: 'https://media.example/video.mp4' }] });
    return new Promise(resolve => pending.set(url.pathname, resolve));
  };
  const vault = new Vault('', { available: () => false, encrypt: Buffer.from, decrypt: x => x.toString() });
  const provider = new BilibiliProvider(new BilibiliAccount(vault, fetcher));
  const store = { state: { history: [] } } as unknown as Store;
  const gateway = { register: () => 'http://localhost/media', release: () => {} } as unknown as MediaGateway;
  return { pending, calls, provider, sessions: new PlaybackSessions(store, provider, gateway) };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('ordinary video preparation', () => {
  it('resolves dynamic and ordinary cards to identical fresh part and 4K playback parameters', async () => {
    const bvid = 'BV1uday6xEW6';
    const dynamic = normalizeDynamic({ id_str: 'dynamic-id', modules: {
      module_dynamic: { major: { archive: { aid: '42', bvid, title: '动态卡片', duration_text: '10:00' } } },
    } }).video!;
    const ordinary = normalizeVideo({ aid: 42, bvid, title: '普通卡片', player_args: { cid: 101 } });
    const requests: Record<string, string>[] = [];
    for (const input of [dynamic, ordinary]) {
      const f = fixture();
      const job = f.sessions.resolve(input, undefined, 120);
      f.pending.get('/x/web-interface/nav')!(response(keys));
      f.pending.get('/x/web-interface/view')!(response({ aid: 42, bvid, title: '最新标题',
        pages: [{ cid: 101, part: '第一集' }] }));
      const source = await job;
      const params = Object.fromEntries(f.calls.find(url => url.pathname.endsWith('/playurl'))!.searchParams);
      delete params.w_rid;
      delete params.wts;
      requests.push(params);
      expect(source.part?.cid).toBe(101);
      expect(source.item.title).toBe('最新标题');
      await f.sessions.release(source.sessionId);
    }
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]).toMatchObject({ cid: '101', bvid, avid: '42', qn: '120',
      fnval: '4048', fourk: '1', high_quality: '1' });
  });

  it('starts detail and keys together; play still waits for fresh detail and signs the selected part', async () => {
    const f = fixture();
    const job = f.sessions.resolve(item, { id: 'cid:2', cid: 2, title: '旧分集' }, 64);
    expect(f.calls.map(url => url.pathname)).toEqual(['/x/web-interface/nav', '/x/web-interface/view']);
    f.pending.get('/x/web-interface/nav')!(response(keys));
    await settle();
    expect(f.calls).toHaveLength(2);
    f.pending.get('/x/web-interface/view')!(response({ aid: 42, title: '新标题', pages: [
      { cid: 1, part: '第一集' }, { cid: 2, part: '第二集' },
    ] }));
    const source = await job;
    expect(source.item.title).toBe('新标题');
    expect(source.part?.cid).toBe(2);
    expect(source.parts).toHaveLength(2);
    expect(f.calls[2].searchParams.get('cid')).toBe('2');
    expect(f.calls[2].searchParams.get('qn')).toBe('64');
    expect(f.calls[2].searchParams.has('w_rid')).toBe(true);
    await f.sessions.release(source.sessionId);
  });

  it('keeps detail failure authoritative even when the parallel key request also fails', async () => {
    const f = fixture();
    const job = f.sessions.resolve(item);
    const rejected = expect(job).rejects.toThrow('B 站暂时无法提供此内容');
    f.pending.get('/x/web-interface/nav')!(new Response('invalid'));
    await settle();
    f.pending.get('/x/web-interface/view')!(response(null, -404));
    // The API error text must propagate; no signed media request or unrelated fallback.
    await rejected;
    expect(f.calls).toHaveLength(2);
  });

  it('propagates key failure after successful detail without sending unsigned playback', async () => {
    const f = fixture();
    const job = f.provider.playbackDetail(item);
    const rejected = expect(job).rejects.toThrow('验证页面');
    f.pending.get('/x/web-interface/nav')!(new Response('invalid'));
    f.pending.get('/x/web-interface/view')!(response({ aid: 42, title: '标题', pages: [{ cid: 1, part: '第一集' }] }));
    await rejected;
    expect(f.calls).toHaveLength(2);
  });
});
