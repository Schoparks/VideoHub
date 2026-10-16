import { describe, expect, it } from 'vitest';
import { BilibiliAccount } from '../electron/accounts/bilibili-account';
import { Vault } from '../electron/accounts/vault';
import { BilibiliProvider, normalizeDynamic, normalizeVideo } from '../electron/providers/bilibili';
import { buildDashManifest, playbackQualities } from '../electron/playback/dash';
import { schemas } from '../electron/ipc';

const response = (data: any, code = 0) => new Response(JSON.stringify({ code, data }), { headers: { 'content-type': 'application/json' } });
const memoryVault = () => new Vault('', { available: () => false, encrypt: Buffer.from, decrypt: x => x.toString() });
const video = { id: 'bili:BV17x411w7KC', source: 'bilibili' as const, kind: 'video' as const, title: '示例', bvid: 'BV17x411w7KC', cid: 123 };
const track = (id: number, codecs = 'avc1.640028') => ({ id, codecs, bandwidth: 1000000, baseUrl: `https://media.example/${id}.m4s`, width: 1920, height: 1080, SegmentBase: { Initialization: '0-899', indexRange: '900-1199' } });
const dynamic = (id: string, content: any = {}, original?: any) => ({ id_str: id, modules: { module_author: { name: '作者', face: 'http://i0.hdslb.com/avatar.jpg', pub_ts: 1700000000 }, module_dynamic: content }, orig: original });

describe('Bilibili dynamic feed', () => {
  it('preserves text, images, timestamps, and forwarded video data', () => {
    const original = dynamic('90071992547409931234', { major: { archive: { aid: '99', bvid: video.bvid, title: '视频', cover: '//i0.hdslb.com/cover.jpg', duration_text: '01:25' } } });
    const normalized = normalizeDynamic(dynamic('90071992547409939999', { desc: { text: '转发内容' }, major: { draw: { items: [{ src: 'http://i0.hdslb.com/draw.jpg' }] } } }, original));
    expect(normalized).toMatchObject({ id: '90071992547409939999', text: '转发内容', publishedAt: 1700000000000, avatar: 'https://i0.hdslb.com/avatar.jpg', images: ['https://i0.hdslb.com/draw.jpg'] });
    expect(normalized.original?.video).toMatchObject({ aid: 99, bvid: video.bvid, duration: 85, cover: 'https://i0.hdslb.com/cover.jpg' });
    expect(normalized.original?.url).toBe('https://t.bilibili.com/90071992547409931234');
  });
  it('renders opus content and deleted originals without dropping the parent', () => {
    const entry = normalizeDynamic(dynamic('100', { major: { opus: { title: '标题', summary: { text: '正文' }, pics: [{ url: '//i0.hdslb.com/image.jpg' }] } } }, dynamic('99', { major: { none: { tips: '源动态已删除' } } })));
    expect(entry.text).toBe('标题\n正文');
    expect(entry.images).toEqual(['https://i0.hdslb.com/image.jpg']);
    expect(entry.original?.text).toBe('源动态已删除');
  });
  it('uses the requested filter and opaque offset, resets on refresh and stops repeated cursors', async () => {
    const vault = memoryVault(); vault.value.cookie = 'SESSDATA=test';
    const urls: URL[] = [];
    const fetcher = (async (input: any) => { const url = new URL(input); urls.push(url); return response({ offset: 'next-token', has_more: true, items: [dynamic('1', { desc: { text: '纯文字' } }), dynamic('2', { major: { archive: { aid: 99, title: '视频' } } })] }); }) as typeof fetch;
    const provider = new BilibiliProvider(new BilibiliAccount(vault, fetcher));
    const all = await provider.browse({ kind: 'dynamic', dynamicType: 'all' });
    expect(all.dynamics).toHaveLength(2); expect(all.hasMore).toBe(true);
    const filtered = await provider.browse({ kind: 'dynamic', dynamicType: 'video', cursor: all.cursor });
    expect(filtered.dynamics).toHaveLength(1); expect(filtered.hasMore).toBe(false);
    expect(urls[1].searchParams.get('offset')).toBe('next-token'); expect(urls[1].searchParams.get('type')).toBe('video');
    await provider.browse({ kind: 'dynamic', dynamicType: 'all', cursor: 'stale', refresh: true });
    expect(urls[2].searchParams.get('offset')).toBe('');
    expect(schemas.browse.safeParse([{ kind: 'dynamic', dynamicType: 'video' }]).success).toBe(true);
    expect(schemas.browse.safeParse([{ kind: 'dynamic', dynamicType: 'unsafe' }]).success).toBe(false);
  });
});

describe('authenticated playback and quality', () => {
  it('retains web credentials issued with App QR approval and sends them to the playback API', async () => {
    const vault = memoryVault(); const playbackRequests: { url: URL; headers: Record<string, string> }[] = [];
    const fetcher = (async (input: any, init: any) => {
      const url = new URL(input);
      if (url.pathname.endsWith('auth_code')) return response({ auth_code: 'test-code', url: 'https://example.com/qr' });
      if (url.pathname.endsWith('/poll')) return response({ token_info: { access_token: 'app-test', mid: 42, expires_in: 3600 }, cookie_info: { cookies: [{ name: 'SESSDATA', value: 'session-test' }, { name: 'DedeUserID', value: '42' }, { name: 'bili_jct', value: 'csrf-test' }] } });
      if (url.pathname.endsWith('/nav')) return response({ wbi_img: { img_url: `https://i0.hdslb.com/${'a'.repeat(32)}.png`, sub_url: `https://i0.hdslb.com/${'b'.repeat(32)}.png` } });
      playbackRequests.push({ url, headers: init.headers }); return response({ dash: { duration: 20, video: [track(80)] } });
    }) as typeof fetch;
    const account = new BilibiliAccount(vault, fetcher); const qr = await account.start('app');
    expect((await account.poll(qr.id)).state).toBe('success');
    expect(account.status()).toMatchObject({ app: true, web: true, appMid: '42', webMid: '42' });
    const played = await new BilibiliProvider(account).play(video);
    expect(played.playbackNotice).toBeUndefined();
    expect(playbackRequests[0].url.searchParams.get('qn')).toBe('127');
    expect(playbackRequests[0].headers.Cookie).toContain('SESSDATA=session-test');
  });
  it('shows why an existing App-only login still receives anonymous playback', async () => {
    const vault = memoryVault(); vault.value.accessToken = 'app-test';
    const fetcher = (async (input: any) => new URL(input).pathname.endsWith('/nav') ? response({ wbi_img: { img_url: `https://i0.hdslb.com/${'a'.repeat(32)}.png`, sub_url: `https://i0.hdslb.com/${'b'.repeat(32)}.png` } }) : response({ dash: { duration: 20, video: [track(32)] } })) as typeof fetch;
    expect((await new BilibiliProvider(new BilibiliAccount(vault, fetcher)).play(video)).playbackNotice).toContain('网页登录');
  });
  it('treats scanned-but-unconfirmed App QR responses as scanned instead of expired', async () => {
    const account = new BilibiliAccount(memoryVault(), (async (input: any) => new URL(input).pathname.endsWith('auth_code') ? response({ auth_code: 'test-code', url: 'https://example.com/qr' }) : response(null, 86090)) as typeof fetch);
    expect((await account.poll((await account.start('app')).id)).state).toBe('scanned');
  });
  it('retains high resolution AV1 tracks and lists only genuinely playable qualities', () => {
    const data = { dash: { duration: 30, video: [track(32), track(80, 'av01.0.08M.08'), track(120, 'hev1.1.6.L153.B0')] }, support_formats: [{ quality: 80, new_description: '1080P 高清' }, { quality: 120, new_description: '4K' }] };
    expect(playbackQualities(data)).toEqual([{ id: 80, label: '1080P 高清' }, { id: 32, label: '480P' }]);
    const result = buildDashManifest(data.dash, x => x, 127);
    expect(result.quality).toBe(80); expect(result.manifest).toContain('av01.0.08M.08');
    expect(result.manifest).not.toContain('hev1');
    expect(buildDashManifest(data.dash, x => x, 32).quality).toBe(32);
  });
});

describe('App recommendation profile', () => {
  it('uses BewlyCat App authorization and cookies without a Web recommendation fallback', async () => {
    const vault = memoryVault(); vault.value = { accessToken: 'app-test', cookie: 'SESSDATA=web-test' };
    const requests: { url: URL; headers: Record<string, string> }[] = [];
    const fetcher = (async (input: any, init: any) => { requests.push({ url: new URL(input), headers: init.headers }); return response({ items: [{ card_type: 'small_cover_v2', goto: 'av', args: { aid: requests.length }, bvid: `BV-fixture-${requests.length}`, title: '推荐视频', idx: 10 + requests.length }] }); }) as typeof fetch;
    const provider = new BilibiliProvider(new BilibiliAccount(vault, fetcher));
    await provider.browse({ kind: 'recommend' });
    await provider.browse({ kind: 'recommend', cursor: '1' });
    await provider.browse({ kind: 'recommend', refresh: true });
    for (const req of requests) {
      expect(req.url.hostname).toBe('app.bilibili.com'); expect(req.url.searchParams.get('access_key')).toBe('app-test');
      expect(req.url.searchParams.get('device')).toBe('pad'); expect(req.headers['User-Agent']).toContain('Mozilla/'); expect(req.headers['User-Agent']).not.toContain('bili-universal'); expect(req.headers.Cookie).toBe('SESSDATA=web-test');
    }
    expect(requests.every(req => !req.url.searchParams.has('pull'))).toBe(true);
    expect(requests[1].url.searchParams.get('idx')).toBe('11');
    expect(requests[2].url.searchParams.get('idx')).toBe('1');
  });
  it('normalizes inline App video metadata and insecure cover URLs', () => {
    expect(normalizeVideo({ card_goto: 'av', title: '行内视频', cover: 'http://i0.hdslb.com/cover.jpg', player_args: { aid: 99, cid: 100, duration: 150 }, args: { up_name: '作者' } })).toMatchObject({ aid: 99, cid: 100, duration: 150, cover: 'https://i0.hdslb.com/cover.jpg', author: '作者' });
  });
});
