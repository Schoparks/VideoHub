import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PlaybackSessions } from '../electron/playback/session';
import { Store } from '../electron/storage/store';
import { parseUrl } from '../electron/providers/local';
import type { BilibiliProvider } from '../electron/providers/bilibili';
import type { MediaGateway } from '../electron/playback/gateway';
import type { UrlMediaResolver } from '../electron/providers/url-media';

async function fixture(run: (value: { sessions: PlaybackSessions; store: Store;
  register: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }) => Promise<void>) {
  await mkdir(resolve('.tmp'), { recursive: true });
  const directory = await mkdtemp(resolve('.tmp/web-session-'));
  const store = new Store(directory);
  await store.init();
  const dispose = vi.fn();
  let generation = 0;
  const resolver: UrlMediaResolver = async item => ({ item: { ...item, title: '网页标题' },
    url: `https://cdn.example/video.mp4?generation=${++generation}`, format: 'file', dispose });
  const register = vi.fn(() => 'http://127.0.0.1/media/capability');
  const release = vi.fn();
  const gateway = { register, release } as unknown as MediaGateway;
  const sessions = new PlaybackSessions(store, {} as BilibiliProvider, gateway, undefined, resolver);
  try { await run({ sessions, store, register, dispose, release }); }
  finally { await sessions.close(); await rm(directory, { recursive: true, force: true }); }
}

describe('webpage playback lifetime', () => {
  it('persists the original page and resumes with freshly resolved media', async () => {
    await fixture(async ({ sessions, store, register, dispose }) => {
      const item = parseUrl('https://small.example/watch/123');
      const first = await sessions.resolve(item);
      await sessions.progress(first.sessionId, 31.25, 100, true);
      await sessions.release(first.sessionId);
      expect(store.state.history[0].item).toEqual({ ...item, title: '网页标题' });
      const second = await sessions.resolve(store.state.history[0].item);
      expect(second.startAt).toBe(31.25);
      expect(register.mock.calls[0][0].url).toContain('generation=1');
      expect(register.mock.calls[1][0].url).toContain('generation=2');
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  });

  it('clears webpage resources even when saving the final progress fails', async () => {
    await fixture(async ({ sessions, store, dispose, release }) => {
      const source = await sessions.resolve(parseUrl('https://small.example/watch/123'));
      await sessions.progress(source.sessionId, 10, 100, true);
      vi.spyOn(store, 'record').mockRejectedValueOnce(new Error('disk full'));
      await expect(sessions.release(source.sessionId)).rejects.toThrow('disk full');
      expect(release).toHaveBeenCalledWith(source.sessionId);
      expect(dispose).toHaveBeenCalledTimes(1);
      await sessions.release(source.sessionId);
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  });

  it('clears the isolated webpage when registering its media fails', async () => {
    await fixture(async ({ sessions, register, dispose, release }) => {
      register.mockImplementationOnce(() => { throw new Error('invalid media'); });
      await expect(sessions.resolve(parseUrl('https://small.example/watch/123'))).rejects.toThrow('invalid media');
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    });
  });
});
