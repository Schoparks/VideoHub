import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlaybackSessions } from '../electron/playback/session';
import { Store } from '../electron/storage/store';
import type { BilibiliProvider } from '../electron/providers/bilibili';
import type { MediaGateway } from '../electron/playback/gateway';
import type { AccountStatus, MediaItem, MediaPart } from '../src/shared/types';
import type { fetchDanmaku } from '../electron/providers/bilibili-danmaku';
import type { VideoSupport } from '../electron/playback/dash-video';

const item: MediaItem = { id: 'bili:42', source: 'bilibili', kind: 'video', title: '分集视频', aid: 42 };
const parts: MediaPart[] = [
  { id: 'cid:101', cid: 101, title: '第一集', duration: 120 },
  { id: 'cid:102', cid: 102, title: '第二集', duration: 180 }
];
async function fixture(run: (value: {
  sessions: PlaybackSessions; store: Store; play: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>;
  provider: BilibiliProvider;
}) => Promise<void>, loader?: typeof fetchDanmaku, support?: VideoSupport) {
  const directory = await mkdtemp(join(tmpdir(),'yingji-session-'));
  const store = new Store(directory); await store.init();
  const play = vi.fn(async () => ({ durl: [{ url: 'https://media.example/video.mp4' }], quality: 80, playbackNotice: '当前账号提供的清晰度' }));
  const provider = { playbackDetail: vi.fn(async () => ({ item, parts, description: '' })), play, account: { status: () => ({ web: false }) } } as unknown as BilibiliProvider;
  const release = vi.fn();
  const gateway = { register: ({ session }: { session: string }) => `http://127.0.0.1/media/${session}`, release } as unknown as MediaGateway;
  const sessions = new PlaybackSessions(store,provider,gateway,loader,undefined,support);
  try { await run({ sessions,store,play,release,provider }); }
  finally { await sessions.close(); await rm(directory,{ recursive: true, force: true }); }
}

describe('playback sessions and episodes', () => {
  it('transfers finite device declarations for the current DASH source through the playback contract', async () => {
    const support = Object.assign(() => 2, { inspect: () => ({ mse: true, decoder: 2 as const }) });
    await fixture(async ({ sessions, provider }) => {
      provider.play = vi.fn(async () => ({ dash: { duration: 120, video: [{
        id: 120, codecs: 'avc1.640033', width: 3840, height: 2160, bandwidth: 2000000,
        baseUrl: 'https://media.example/video', SegmentBase: { Initialization: '0-99', indexRange: '100-199' },
      }] } }));
      const source = await sessions.resolve(item, parts[0], 120);
      expect(source.quality).toBe(120);
      expect(source.videoCodec).toBe('H.264');
      expect(JSON.parse(JSON.stringify(source)).videoCapabilities).toEqual([{ codec: 'H.264', mse: true, decoder: 2 }]);
    }, undefined, support);
  });
  it('opens a requested cid instead of matching two missing episode IDs', async () => {
    await fixture(async ({ sessions,store,play }) => {
      await store.record({ item, part: parts[1], position: 37, duration: 180, updatedAt: 1 });
      const source = await sessions.resolve({ ...item, cid: 102 });
      expect(source.part?.id).toBe('cid:102');
      expect(source.parts).toEqual(parts);
      expect(source.startAt).toBe(37);
      expect(play).toHaveBeenCalledWith(item,parts[1],127);
      expect(source.quality).toBe(80);
      expect(source.qualities).toEqual([{ id: 80, label: '1080P' }]);
      expect(source.notice).toBe('当前账号提供的清晰度');
    });
  });
  it('retains the full episode list on a quality change and uses fresh episode metadata', async () => {
    await fixture(async ({ sessions,play }) => {
      const source = await sessions.resolve(item,{ ...parts[1], title: '旧标题' },64);
      expect(source.part).toEqual(parts[1]);
      expect(source.parts).toHaveLength(2);
      expect(play).toHaveBeenCalledWith(item,parts[1],64);
    });
  });
  it('keeps progress separate when moving between episodes', async () => {
    await fixture(async ({ sessions }) => {
      const first = await sessions.resolve(item,parts[0]);
      await sessions.progress(first.sessionId,74,120,true);
      const second = await sessions.resolve(item,parts[1]);
      expect(second.startAt).toBe(0);
      await sessions.progress(second.sessionId,28,180,true);
      expect((await sessions.resolve(item,parts[0])).startAt).toBe(74);
      expect((await sessions.resolve(item,parts[1])).startAt).toBe(28);
    });
  });
  it('rejects an unavailable episode without playing an unrelated cid', async () => {
    await fixture(async ({ sessions,play,release }) => {
      await expect(sessions.resolve(item,{ id: 'cid:999', cid: 999, title: '失效的一集' })).rejects.toThrow('这集已不可用');
      expect(play).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledOnce();
    });
  });

  it('returns after local persistence while platform sync is pending; newest queued seek wins', async () => {
    await fixture(async ({ sessions, store, provider }) => {
      provider.account.status = vi.fn((): AccountStatus => ({ app: false, web: true, webMid: 'fixture', storage: 'memory' }));
      let finish!: () => void;
      const remote = new Promise<void>(resolve => { finish = resolve; });
      provider.heartbeat = vi.fn().mockImplementationOnce(() => remote).mockResolvedValue(undefined);
      const source = await sessions.resolve(item, parts[0]);
      expect(await sessions.progress(source.sessionId, 37, 120, true)).toEqual({ synced: false, warning: undefined });
      expect(store.state.history[0].position).toBe(37);
      await sessions.progress(source.sessionId, 45, 120, true);
      await sessions.progress(source.sessionId, 5, 120, true);
      expect(provider.heartbeat).toHaveBeenCalledTimes(1);
      finish();
      await vi.waitFor(() => expect(provider.heartbeat).toHaveBeenCalledTimes(2));
      expect(vi.mocked(provider.heartbeat).mock.calls.map(call => call[2])).toEqual([37, 5]);
      await vi.waitFor(async () => expect((await sessions.progress(source.sessionId, 5, 120)).synced).toBe(true));
    });
  });

  it('reports remote failures on following progress without losing local history', async () => {
    await fixture(async ({ sessions, store, provider }) => {
      provider.account.status = vi.fn((): AccountStatus => ({ app: false, web: true, webMid: 'fixture', storage: 'memory' }));
      provider.heartbeat = vi.fn().mockRejectedValue(new Error('platform timeout'));
      const source = await sessions.resolve(item, parts[0]);
      await sessions.progress(source.sessionId, 74, 120, true);
      await vi.waitFor(async () => expect((await sessions.progress(source.sessionId, 74, 120)).warning).toContain('进度已保存到本机'));
      expect(store.state.history[0].position).toBe(74);
      await sessions.release(source.sessionId);
      expect((await sessions.resolve(item, parts[0])).startAt).toBe(74);
    });
  });

  it('skips waiting remote writes after account replacement', async () => {
    await fixture(async ({ sessions, provider }) => {
      let accountId = 'original';
      provider.account.status = vi.fn((): AccountStatus => ({ app: false, web: true, webMid: accountId, storage: 'memory' }));
      let finish!: () => void;
      const remote = new Promise<void>(resolve => { finish = resolve; });
      provider.heartbeat = vi.fn(() => remote);
      const source = await sessions.resolve(item, parts[0]);
      await sessions.progress(source.sessionId, 37, 120, true);
      await sessions.progress(source.sessionId, 45, 120, true);
      accountId = 'replacement';
      finish();
      await vi.waitFor(async () => expect(await sessions.progress(source.sessionId, 45, 120)).toEqual({ synced: false, warning: undefined }));
      expect(provider.heartbeat).toHaveBeenCalledTimes(1);
    });
  });

  it('revokes every media capability during close even when saving one session fails', async () => {
    await fixture(async ({ sessions, store, release }) => {
      const first = await sessions.resolve(item, parts[0]);
      const second = await sessions.resolve(item, parts[1]);
      await sessions.progress(first.sessionId, 37, 120, true);
      await sessions.progress(second.sessionId, 48, 180, true);
      vi.spyOn(store, 'record').mockRejectedValueOnce(new Error('disk full'));
      await expect(sessions.close()).rejects.toThrow('disk full');
      expect(release).toHaveBeenCalledWith(first.sessionId);
      expect(release).toHaveBeenCalledWith(second.sessionId);
      expect(await sessions.progress(first.sessionId, 50, 120, true)).toEqual({ synced: false });
      expect(store.state.history.find(entry => entry.part?.id === parts[1].id)?.position).toBe(48);
    });
  });

  it('loads comments for the resolved episode, shares its pending request and aborts on release', async () => {
    const loader = vi.fn((_cid: number, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    await fixture(async ({ sessions }) => {
      const source = await sessions.resolve(item, parts[1]);
      const first = expect(sessions.danmaku(source.sessionId)).rejects.toThrow('aborted');
      const second = expect(sessions.danmaku(source.sessionId)).rejects.toThrow('aborted');
      expect(loader).toHaveBeenCalledTimes(1);
      expect(loader.mock.calls[0][0]).toBe(102);
      await sessions.release(source.sessionId);
      await Promise.all([first, second]);
      await expect(sessions.danmaku(source.sessionId)).rejects.toThrow('播放会话已结束');
    }, loader);
  });
});
