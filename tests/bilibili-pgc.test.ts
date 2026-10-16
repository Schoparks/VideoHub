import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BilibiliAccount } from '../electron/accounts/bilibili-account';
import { Vault } from '../electron/accounts/vault';
import { BilibiliProvider } from '../electron/providers/bilibili';
import { normalizeSeason } from '../electron/providers/bilibili-pgc';
import { PlaybackSessions } from '../electron/playback/session';
import type { MediaGateway } from '../electron/playback/gateway';
import { Store } from '../electron/storage/store';
import { schemas } from '../electron/ipc';
import type { MediaItem, MediaPart } from '../src/shared/types';

const historyRecord = {
  title: '影视剧测试',
  long_title: '第 2 集',
  cover: 'http://i0.hdslb.com/fixture.jpg',
  duration: 180,
  history: { business: 'pgc', oid: 123, epid: 702, bvid: '', cid: 0, page: 0 },
};
const season = {
  season_id: 70,
  title: '影视剧测试',
  episodes: [
    { id: '701', aid: 0, bvid: '', cid: '9001', title: '1', duration: 180000 },
    { id: 702, aid: 0, bvid: '', cid: 9002, title: '2', duration: 180000 },
  ],
};
const response = (data: unknown, pgc = false) => new Response(
  JSON.stringify({ code: 0, [pgc ? 'result' : 'data']: data }),
  { headers: { 'content-type': 'application/json' } },
);

async function fixture(run: (value: {
  provider: BilibiliProvider;
  sessions: PlaybackSessions;
  store: Store;
  requests: URL[];
  directory: string;
}) => Promise<void>) {
  const root = join(process.cwd(), '.tmp');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'pgc-playback-'));
  const store = new Store(directory);
  await store.init();
  const vault = new Vault('', { available: () => false, encrypt: Buffer.from, decrypt: value => value.toString() });
  vault.value.cookie = 'SESSDATA=fixture-only';
  const requests: URL[] = [];
  const fetcher = (async (input: any) => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname.endsWith('/history/cursor')) return response({ list: [historyRecord], cursor: {} });
    if (url.pathname.endsWith('/pgc/view/web/season')) return response(season, true);
    if (url.pathname.endsWith('/pgc/player/web/v2/playurl')) {
      return response({ video_info: { durl: [{ url: 'https://media.example/episode.mp4' }], quality: 80 } }, true);
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  }) as typeof fetch;
  const provider = new BilibiliProvider(new BilibiliAccount(vault, fetcher));
  const gateway = {
    register: ({ session }: { session: string }) => `http://127.0.0.1/media/${session}`,
    release: vi.fn(),
  } as unknown as MediaGateway;
  const sessions = new PlaybackSessions(store, provider, gateway);
  try { await run({ provider, sessions, store, requests, directory }); }
  finally {
    await sessions.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('PGC media references across IPC and playback', () => {
  it('opens the history episode without treating empty video IDs as malformed IPC input', async () => {
    await fixture(async ({ provider, sessions, requests }) => {
      const page = await provider.browse({ kind: 'history' });
      const item = page.items[0];
      expect(item).toMatchObject({ kind: 'season', id: 'episode:702', episodeId: 702 });
      expect(item.bvid).toBeUndefined();
      expect(item.cid).toBeUndefined();
      expect(item.aid).toBeUndefined();
      const input = schemas.resolve.parse([item]);
      const source = await sessions.resolve(...input);
      expect(source.part?.episodeId).toBe(702);
      expect(source.part?.cid).toBe(9002);
      expect(source.parts).toHaveLength(2);
      expect(source.parts?.[0]).toMatchObject({ episodeId: 701, cid: 9001 });
      expect(requests[1].searchParams.get('ep_id')).toBe('702');
      const play = requests.find(url => url.pathname.endsWith('/pgc/player/web/v2/playurl'))!;
      expect(play.searchParams.get('ep_id')).toBe('702');
      expect(play.searchParams.get('cid')).toBe('9002');
      expect(play.searchParams.has('bvid')).toBe(false);
      expect(play.searchParams.has('avid')).toBe(false);
    });
  });

  it('keeps normalized parts usable for episode switches, quality changes and saved progress', async () => {
    await fixture(async ({ provider, sessions, store, requests }) => {
      const [item] = (await provider.browse({ kind: 'history' })).items;
      const source = await sessions.resolve(item);
      const firstPart = source.parts![0];
      const input = schemas.resolve.parse([source.item, firstPart, 64]);
      const first = await sessions.resolve(...input);
      expect(first.part?.episodeId).toBe(701);
      expect(requests.at(-1)?.searchParams.get('qn')).toBe('64');
      await sessions.progress(first.sessionId, 37, 180, true);
      const saved = store.state.history[0];
      expect(schemas.resolve.safeParse([saved.item, saved.part]).success).toBe(true);
      expect((await sessions.resolve(saved.item, saved.part)).startAt).toBe(37);
      expect((await sessions.resolve(source.item, source.part)).startAt).toBe(0);
    });
  });

  it('accepts seasons without a latest episode and keeps strict IPC validation', () => {
    const item = normalizeSeason({ season_id: '70', media_id: 999, title: '影视', new_ep: { id: 0 } });
    expect(item.seasonId).toBe(70);
    expect(item.episodeId).toBeUndefined();
    expect(schemas.resolve.safeParse([item]).success).toBe(true);
    expect(schemas.resolve.safeParse([{ ...item, bvid: '' }]).success).toBe(false);
    expect(schemas.resolve.safeParse([{ ...item, cid: 0 }]).success).toBe(false);
  });

  it('repairs legacy local PGC history and queue placeholders without losing identity or progress', async () => {
    await fixture(async ({ store, directory, sessions }) => {
      const item: MediaItem = {
        id: 'episode:702', source: 'bilibili', kind: 'season', title: '旧影视记录',
        episodeId: 702, seasonId: 70, bvid: '', aid: 0, cid: 0,
      };
      const part: MediaPart = { id: 'ep:702', title: '第 2 集', episodeId: 702, cid: 9002, aid: 0, bvid: '' };
      store.state.queue = [item];
      await store.record({ item, part, position: 47, duration: 180, updatedAt: 123 });
      const restored = new Store(directory);
      await restored.init();
      const saved = restored.state.history[0];
      expect(saved).toMatchObject({ item: { id: item.id }, part: { id: part.id }, position: 47, updatedAt: 123 });
      expect(schemas.resolve.safeParse([saved.item, saved.part]).success).toBe(true);
      expect(schemas.queue.safeParse([restored.state.queue]).success).toBe(true);
      const source = await sessions.resolve(saved.item, saved.part);
      expect(source.part?.episodeId).toBe(702);
      expect(source.startAt).toBe(47);
    });
  });
});
