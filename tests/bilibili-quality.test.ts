import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PlaybackSessions } from '../electron/playback/session';
import { Store } from '../electron/storage/store';
import { schemas } from '../electron/ipc';
import type { BilibiliProvider } from '../electron/providers/bilibili';
import type { MediaGateway } from '../electron/playback/gateway';
import { defaultPreferences, type MediaItem } from '../src/shared/types';
import {
  allowedBilibiliQualities, bilibiliQualityLimits, requestedBilibiliQuality, restoreBilibiliQuality,
} from '../src/shared/bilibili-quality';

const item: MediaItem = { id: 'quality', source: 'bilibili', kind: 'video', title: '清晰度夹具' };
const part = { id: 'first', cid: 1, title: '第一集' };
const track = (id: number) => ({
  id, codecs: 'avc1.640028', width: id >= 120 ? 3840 : 1920, height: id >= 120 ? 2160 : 1080,
  bandwidth: 2000000, baseUrl: `https://media.example/${id}.m4s`,
  SegmentBase: { Initialization: '0-99', indexRange: '100-199' },
});
const data = (ids = [127, 126, 125, 120, 116, 112, 80, 64, 32]) => ({
  dash: { duration: 120, video: ids.map(track) },
  // Advertised, inaccessible formats must not become menu entries.
  accept_quality: [127, 126, 125, 120, 116, 112, 80, 64, 32],
});
function fixture() {
  const store = new Store('.tmp/unused-quality-store');
  const play = vi.fn().mockResolvedValue(data());
  const provider = { play, playbackDetail: vi.fn().mockResolvedValue({ item, parts: [part] }) };
  const register = vi.fn().mockReturnValue('http://localhost/fixture');
  const release = vi.fn();
  const gateway = { register, release } as unknown as MediaGateway;
  const sessions = new PlaybackSessions(store, provider as unknown as BilibiliProvider, gateway);
  return { store, play, register, release, sessions };
}

describe('Bilibili quality cap and automatic selection', () => {
  it('keeps platform order for peer variants, remembers exact choices and uses same-resolution fallback', async () => {
    const { store, sessions, play } = fixture();
    store.state.preferences.bilibiliMaxQuality = 80;
    play.mockResolvedValue(data([120, 112, 116, 80, 64]));
    expect((await sessions.resolve(item)).quality).toBe(112);
    expect((await sessions.resolve(item, part, 116)).quality).toBe(116);
    Object.assign(store.state.preferences, { bilibiliQualityMode: 'remember', bilibiliRememberedQuality: 112 });
    play.mockResolvedValue(data([120, 116, 80, 64]));
    expect((await sessions.resolve(item)).quality).toBe(116);
    expect(store.state.preferences.bilibiliRememberedQuality).toBe(112);
    expect((await sessions.resolve(item)).qualities!.map(value => value.id)).toEqual([116, 80, 64]);
  });
  it.each([116, 112, 80] as const)('maps legacy %s caps to the whole 1080P family', async limit => {
    const { store, sessions, play, register } = fixture();
    store.state.preferences.bilibiliMaxQuality = limit;
    const source = await sessions.resolve(item, part, 127);
    expect(play).toHaveBeenCalledWith(item, part, 116);
    expect(source.quality).toBe(116);
    expect(source.qualities!.map(value => value.id)).toEqual([116, 112, 80, 64, 32]);
    expect(source.qualities!.find(value => value.id === limit)?.label).toBe({
      116: '1080P 60帧', 112: '1080P 高码率', 80: '1080P',
    }[limit]);
    const manifest = register.mock.calls.find(([entry]) => entry.text)![0].text;
    expect(manifest).toContain('video-116');
    expect(manifest).not.toContain('video-120');
  });

  it('uses remembered exact tier, then the highest lower available tier without overwriting memory', async () => {
    const { store, sessions, play } = fixture();
    Object.assign(store.state.preferences, { bilibiliQualityMode: 'remember', bilibiliRememberedQuality: 116 });
    play.mockResolvedValueOnce(data([120, 112, 80, 64])).mockResolvedValueOnce(data([120, 80, 64]));
    expect((await sessions.resolve(item)).quality).toBe(112);
    expect((await sessions.resolve(item)).quality).toBe(80);
    expect(store.state.preferences.bilibiliRememberedQuality).toBe(116);
    expect((await sessions.resolve(item)).quality).toBe(116);
  });

  it('highest mode re-evaluates each item and ignores remembered tier', async () => {
    const { store, sessions, play } = fixture();
    Object.assign(store.state.preferences, { bilibiliMaxQuality: 116, bilibiliRememberedQuality: 64 });
    play.mockResolvedValueOnce(data([80, 64]));
    expect((await sessions.resolve(item)).quality).toBe(80);
    expect((await sessions.resolve(item)).quality).toBe(116);
  });

  it('manual changes and retries override memory within the cap', async () => {
    const { store, sessions } = fixture();
    Object.assign(store.state.preferences, {
      bilibiliMaxQuality: 112, bilibiliQualityMode: 'remember', bilibiliRememberedQuality: 116,
    });
    expect((await sessions.resolve(item)).quality).toBe(116);
    expect((await sessions.resolve(item, part, 80)).quality).toBe(80);
    expect((await sessions.resolve(item, part, 120)).quality).toBe(116);
  });

  it('never falls back to an over-cap track when only 4K/HDR are returned', async () => {
    const { store, sessions, play, register, release } = fixture();
    store.state.preferences.bilibiliMaxQuality = 116;
    play.mockResolvedValue(data([120, 125]));
    await expect(sessions.resolve(item)).rejects.toThrow('清晰度上限');
    expect(register).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('uses the lowest allowed tier if all available tiers are above the remembered preference', async () => {
    const { store, sessions, play } = fixture();
    Object.assign(store.state.preferences, {
      bilibiliMaxQuality: 116, bilibiliQualityMode: 'remember', bilibiliRememberedQuality: 64,
    });
    play.mockResolvedValue(data([120, 116, 80]));
    expect((await sessions.resolve(item)).quality).toBe(116);
  });

  it('does not fabricate membership qualities and still surfaces permission failures', async () => {
    const { sessions, play } = fixture();
    play.mockResolvedValueOnce(data([32])).mockRejectedValueOnce(new Error('账号权限不足'));
    expect((await sessions.resolve(item)).qualities).toEqual([{ id: 32, label: '480P' }]);
    await expect(sessions.resolve(item)).rejects.toThrow('账号权限不足');
  });

  it.each([120, undefined, 0])('rejects over-cap or unknown MP4 quality %s', async quality => {
    const { store, sessions, play, register } = fixture();
    store.state.preferences.bilibiliMaxQuality = 116;
    play.mockResolvedValue({ quality, durl: [{ url: 'https://media.example/video.mp4' }] });
    await expect(sessions.resolve(item)).rejects.toThrow('清晰度上限');
    expect(register).not.toHaveBeenCalled();
  });

  it('accepts the actual allowed MP4 quality and keeps live outside this policy', async () => {
    const { store, sessions, play } = fixture();
    store.state.preferences.bilibiliMaxQuality = 116;
    play.mockResolvedValueOnce({ quality: 80, durl: [{ url: 'https://media.example/video.mp4' }] });
    expect((await sessions.resolve(item)).quality).toBe(80);
    play.mockResolvedValueOnce({ liveUrl: 'https://media.example/live.m3u8', format: 'hls' });
    const live = { ...item, kind: 'live' as const };
    expect((await sessions.resolve(live)).live).toBe(true);
    expect(play).toHaveBeenLastCalledWith(live, undefined, 127);
  });
});

describe('quality preference migration and validation', () => {
  it('defaults legacy settings to unrestricted highest without resetting other choices', () => {
    const { bilibiliMaxQuality: _cap, bilibiliQualityMode: _mode, bilibiliRememberedQuality: _memory, ...legacy } = defaultPreferences;
    expect(schemas.preferences.parse([{ ...legacy, autoNext: false }])[0]).toMatchObject({
      bilibiliMaxQuality: 0, bilibiliQualityMode: 'highest', bilibiliRememberedQuality: 0, autoNext: false,
    });
    expect(requestedBilibiliQuality({})).toBe(127);
  });

  it('validates explicit tiers, modes and finite remembered values at IPC', () => {
    for (const { id } of bilibiliQualityLimits) {
      expect(schemas.preferences.safeParse([{ ...defaultPreferences, bilibiliMaxQuality: id }]).success).toBe(true);
    }
    for (const patch of [{ bilibiliMaxQuality: 1080 }, { bilibiliQualityMode: 'auto' },
      { bilibiliRememberedQuality: 128 }, { bilibiliRememberedQuality: -1 }, { bilibiliRememberedQuality: 80.5 }]) {
      expect(schemas.preferences.safeParse([{ ...defaultPreferences, ...patch }]).success).toBe(false);
    }
  });

  it('normalizes malformed storage values and filters menus without changing source order', () => {
    expect(allowedBilibiliQualities([{ id: 125 }, { id: 126 }], { bilibiliMaxQuality: 120 })).toEqual([]);
    expect(restoreBilibiliQuality({ bilibiliMaxQuality: 1080 as never, bilibiliRememberedQuality: NaN })).toEqual({
      bilibiliMaxQuality: 0, bilibiliQualityMode: 'highest', bilibiliRememberedQuality: 0,
    });
    expect(allowedBilibiliQualities([{ id: 80 }, { id: 120 }, { id: 116 }, { id: 112 }], { bilibiliMaxQuality: 116 }))
      .toEqual([{ id: 80 }, { id: 116 }, { id: 112 }]);
  });

  it('persists and reloads the policy and exact memory using the existing atomic store', async () => {
    await mkdir('.tmp', { recursive: true });
    const directory = await mkdtemp(join('.tmp', 'quality-store-'));
    try {
      const store = new Store(directory);
      await store.init();
      await store.update(state => ({ ...state, preferences: { ...state.preferences,
        bilibiliMaxQuality: 116, bilibiliQualityMode: 'remember', bilibiliRememberedQuality: 112,
      } }));
      const restored = new Store(directory);
      await restored.init();
      expect(restored.state.preferences).toEqual({ ...store.state.preferences, bilibiliMaxQuality: 80 });
      const old = JSON.parse(await readFile(join(directory, 'library.json'), 'utf8'));
      delete old.preferences.bilibiliMaxQuality;
      delete old.preferences.bilibiliQualityMode;
      delete old.preferences.bilibiliRememberedQuality;
      old.preferences.autoNext = false;
      await writeFile(join(directory, 'library.json'), JSON.stringify(old));
      await restored.init();
      expect(restored.state.preferences).toMatchObject({
        bilibiliMaxQuality: 0, bilibiliQualityMode: 'highest', bilibiliRememberedQuality: 0, autoNext: false,
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
