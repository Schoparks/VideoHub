import { describe, expect, it, vi } from 'vitest';
import { BilibiliAccount } from '../electron/accounts/bilibili-account';
import { Vault } from '../electron/accounts/vault';
import { BilibiliProvider } from '../electron/providers/bilibili';
import { buildDashManifest, playbackQualities } from '../electron/playback/dash';
import type { MediaItem } from '../src/shared/types';
import { mp4Initialization } from './fixtures/mp4';

const item: MediaItem = {
  id: 'season:210727', source: 'bilibili', kind: 'season', title: '黑袍纠察队 第一季',
  seasonId: 210727, episodeId: 3457304,
};
const part = { id: 'ep:3457305', title: '第 2 集', episodeId: 3457305, cid: 37011196309 };
const track = (id: number, codecs = 'avc1.64001F') => ({
  id, codecs, bandwidth: 1000000, width: 852, height: 480,
  base_url: `https://media.example/${id}.m4s`,
  segment_base: { initialization: '0-899', index_range: '900-1199' },
});
const plainVideo = () => ({
  is_drm: false, is_preview: 0, quality: 32,
  dash: { duration: 3200, video: [track(32), track(16)], audio: [track(30280, 'mp4a.40.2')] },
});

function fixture(result: unknown, options = { web: true, code: 0 }) {
  const vault = new Vault('', { available: () => false, encrypt: Buffer.from, decrypt: value => value.toString() });
  if (options.web) vault.value.cookie = 'SESSDATA=fixture-only';
  const requests: { url: URL; headers: HeadersInit | undefined }[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, headers: init?.headers });
    const body = typeof result === 'function' ? result(url) : result;
    return new Response(JSON.stringify({ code: options.code, message: '会员权限不足', result: body }));
  }) as unknown as typeof fetch;
  return { provider: new BilibiliProvider(new BilibiliAccount(vault, fetcher)), requests };
}

describe('native PGC playback', () => {
  it('retains the title DRM marker while accepting verified clear media with unchanged permissions', async () => {
    const bytes = mp4Initialization();
    const video = plainVideo();
    const update = (entry: any) => ({ ...entry, base_url: `https://media.bilivideo.com/${entry.id}.m4s`,
      segment_base: { initialization: `0-${bytes.length - 1}`, index_range: '900-1199' } });
    const { provider, requests } = fixture({ video_info: {
      ...video, is_drm: true, dash: { ...video.dash, video: video.dash.video.map(update), audio: video.dash.audio.map(update) },
    }, play_check: { play_detail: 'PLAY_WHOLE' } });
    const probe = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      expect(new Headers(options?.headers).get('Cookie')).toBeNull();
      return new Response(new Uint8Array(bytes), { status: 206,
        headers: { 'content-range': `bytes 0-${bytes.length - 1}/1000000` } });
    });
    try {
      const data = await provider.play(item, part, 64);
      expect(data.is_drm).toBe(true);
      expect(data.is_preview).toBe(false);
      expect(data.dash.video).toHaveLength(2);
      expect(requests).toHaveLength(1);
      expect(requests[0].url.searchParams.get('ep_id')).toBe('3457305');
      expect(requests[0].url.searchParams.get('qn')).toBe('64');
      expect(new Headers(requests[0].headers).get('Cookie')).toBe('SESSDATA=fixture-only');
    } finally { probe.mockRestore(); }
  });

  it('unwraps v2 video_info and requests the selected episode with web credentials', async () => {
    const { provider, requests } = fixture({ video_info: plainVideo(), play_check: { play_detail: 'PLAY_WHOLE' } });
    const data = await provider.play(item, part, 64);
    const request = requests[0];
    expect(request.url.pathname).toBe('/pgc/player/web/v2/playurl');
    expect(request.url.searchParams.get('ep_id')).toBe('3457305');
    expect(request.url.searchParams.get('cid')).toBe('37011196309');
    expect(request.url.searchParams.get('qn')).toBe('64');
    expect(request.url.searchParams.get('fnval')).toBe('4048');
    expect(request.url.searchParams.has('bvid')).toBe(false);
    expect(request.url.searchParams.has('avid')).toBe(false);
    expect(new Headers(request.headers).get('Cookie')).toBe('SESSDATA=fixture-only');
    expect(data.playbackNotice).toBeUndefined();
    expect(playbackQualities(data)).toEqual([{ id: 32, label: '480P' }, { id: 16, label: '360P' }]);
    expect(buildDashManifest(data.dash, url => url, 64).manifest).toContain('avc1.64001F');
  });

  it('resolves episodes without a cid instead of requiring ordinary video metadata', async () => {
    const { provider, requests } = fixture({ video_info: plainVideo() });
    await provider.play(item);
    expect(requests[0].url.searchParams.get('ep_id')).toBe('3457304');
    expect(requests[0].url.searchParams.has('cid')).toBe(false);
  });

  it.each([false, 0, '0', 'false'])('does not reject explicitly unencrypted streams for technology metadata (%s)', async is_drm => {
    const { provider } = fixture({ video_info: { ...plainVideo(), is_drm, drm_tech_type: 2 } });
    expect((await provider.play(item)).dash.video).toHaveLength(2);
  });

  it('accepts flat responses for compatibility', async () => {
    expect((await fixture(plainVideo()).provider.play(item)).dash.video).toHaveLength(2);
  });

  it('negotiates a native MP4 when the platform returns protected DASH, preserving identity and credentials', async () => {
    const { provider, requests } = fixture((url: URL) => url.searchParams.get('fnval') === '1'
      ? { quality: 16, is_preview: 0, durl: [{ url: 'https://media.example/full.mp4' }] }
      : { video_info: { ...plainVideo(), is_drm: true } });
    const data = await provider.play(item, part, 80);
    expect(data.quality).toBe(16);
    expect(data.durl[0].url).toBe('https://media.example/full.mp4');
    expect(data.playbackNotice).toBeUndefined();
    expect(playbackQualities(data)).toEqual([{ id: 16, label: '360P' }]);
    expect(requests).toHaveLength(2);
    expect(requests[1].url.pathname).toBe('/pgc/player/web/v2/playurl');
    expect(requests.map(request => request.url.searchParams.get('ep_id'))).toEqual(['3457305', '3457305']);
    expect(requests.map(request => request.url.searchParams.get('qn'))).toEqual(['80', '80']);
    expect(requests.map(request => new Headers(request.headers).get('Cookie'))).toEqual([
      'SESSDATA=fixture-only', 'SESSDATA=fixture-only',
    ]);
    expect(requests[1].url.searchParams.get('fnval')).toBe('1');
    expect(requests[1].url.searchParams.has('drm_tech_type')).toBe(false);
  });

  it('retries legacy multi-part streams as compatible MP4 without changing episode identity', async () => {
    const { provider, requests } = fixture((url: URL) => ({
      quality: 16, is_drm: false,
      durl: url.searchParams.get('fnval') === '1'
        ? [{ url: 'https://media.example/full.mp4' }]
        : [{ url: 'https://media.example/1.flv' }, { url: 'https://media.example/2.flv' }],
    }));
    expect((await provider.play(item, part)).durl).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it('preserves preview status of the compatible format instead of claiming full playback', async () => {
    const { provider } = fixture((url: URL) => url.searchParams.get('fnval') === '1'
      ? { quality: 16, is_preview: 1, durl: [{ url: 'https://media.example/preview.mp4' }] }
      : { video_info: { ...plainVideo(), is_drm: true } });
    expect((await provider.play(item, part)).playbackNotice).toContain('试看');
  });

  it('does not mislabel string zero preview flags', async () => {
    const { provider } = fixture({ video_info: { ...plainVideo(), is_preview: '0', isPreview: 'false' } });
    expect((await provider.play(item)).playbackNotice).toBeUndefined();
  });

  it('keeps previews explicit even for visitors and when v2 only reports play_check', async () => {
    const { provider } = fixture({
      video_info: { is_drm: false, quality: 16, durl: [{ url: 'https://media.example/preview.mp4' }] },
      play_check: { play_detail: 'PLAY_PREVIEW' },
    }, { web: false, code: 0 });
    expect((await provider.play(item, part)).playbackNotice).toContain('试看');
  });

  it.each([true, 1, '1', 'true'])('rejects DRM when the compatible format is also protected (%s)', async is_drm => {
    const { provider, requests } = fixture({ video_info: { ...plainVideo(), is_drm, drm_tech_type: 2 } });
    await expect(provider.play(item)).rejects.toThrow('DRM 加密');
    expect(requests).toHaveLength(2);
  });

  it('does not assume a title DRM marker means clear media when initialization cannot be verified', async () => {
    const { provider } = fixture({ video_info: { ...plainVideo(), is_drm: true } });
    await expect(provider.play(item)).rejects.toThrow('暂无法验证');
  });

  it('excludes encrypted representations while retaining clear playable qualities', async () => {
    const video = plainVideo();
    const { provider } = fixture({ video_info: {
      ...video, dash: { ...video.dash, video: [{ ...track(80), drm_tech_type: 2 }, track(32)] },
    } });
    expect(playbackQualities(await provider.play(item))).toEqual([{ id: 32, label: '480P' }]);
  });

  it('rejects when only encrypted audio is returned', async () => {
    const video = plainVideo();
    const { provider } = fixture({ video_info: {
      ...video, dash: { ...video.dash, audio: [{ ...track(30280, 'mp4a.40.2'), is_drm: true }] },
    } });
    await expect(provider.play(item)).rejects.toThrow('DRM 加密');
  });

  it.each([
    { code: -10403, message: '无权限' },
    { video_info: { code: -10403, message: '无权限' } },
    { video_info: plainVideo(), play_check: { play_detail: 'PLAY_NONE' } },
    { video_info: { is_drm: false } },
  ])('preserves nested permission errors and missing-stream failures', async result => {
    await expect(fixture(result).provider.play(item)).rejects.toThrow(/无权限|无法播放|没有可用播放流/);
  });

  it('does not fall back to other endpoints on account permission failures', async () => {
    const { provider, requests } = fixture(null, { web: true, code: -10403 });
    await expect(provider.play(item)).rejects.toThrow('会员权限不足');
    expect(requests).toHaveLength(1);
  });
});
