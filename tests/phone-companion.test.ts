import { describe, expect, it, vi } from 'vitest';
import { companionCommand, companionPreferences, companionReply, type CompanionPlayer } from '../src/shared/companion-schema';
import { parseControllerCommand } from '../src/shared/remote-control';
import { defaultPreferences } from '../src/shared/types';
import { playerCompanion, companionTransition } from '../src/hooks/player-companion';
import { CompanionCatalog } from '../src/hooks/companion-catalog';
import { relatedBilibili } from '../electron/providers/bilibili-related';
import type { BilibiliAccount } from '../electron/accounts/bilibili-account';

vi.mock('../src/api', () => ({ api: {} }));
const session = 'f0000000-0000-4000-8000-000000000001';
describe('phone companion boundaries', () => {
  it('keeps lightweight frontend validation aligned with the backend command schema', () => {
    const commands = [
      { kind: 'snapshot' }, { kind: 'cover', handle: session }, { kind: 'play', handle: session },
      { kind: 'tv-login', operation: 'web' }, { kind: 'tv-login', operation: 'close' },
      { kind: 'tv-login', operation: 'logout' }, { kind: 'folders' },
      { kind: 'catalog', collection: 'favorites', folder: session },
      { kind: 'catalog', collection: 'history', cursor: 'opaque' },
      { kind: 'catalog', collection: 'localHistory' },
      ...['dynamic', 'regions', 'cinema', 'followingCinema'].map(collection => ({ kind: 'catalog', collection, category: 1, dynamicType: 'all' })),
      ...[-1, 0, 1.5, 1001].map(category => ({ kind: 'catalog', collection: 'regions', category })),
      { kind: 'catalog', collection: 'dynamic', dynamicType: 'invalid' },
      { kind: 'queue-edit', operation: 'up', handle: session },
      { kind: 'queue-edit', operation: 'replace', handle: session },
      { kind: 'collection-edit', collection: 'favorites', folder: session, handle: session, add: true },
      { kind: 'collection-edit', collection: 'favorites', folder: 123, handle: session, add: true },
      { kind: 'catalog', collection: 'search', keyword: ' 中文 ', searchType: 'all', page: 2 },
      ...[0, 116, 80, 999].map(value => ({ kind: 'settings', patch: { bilibiliMaxQuality: value } })),
      ...[.5, 1, 2, 10].map(value => ({ kind: 'player', session, command: { operation: 'rate', value } })),
      { kind: 'settings', patch: { volume: .4 } }, { kind: 'player', session, command: { operation: 'exitProcess' } },
    ];
    for (const command of commands) {
      const checked = companionCommand.safeParse(command);
      expect(parseControllerCommand(command)).toEqual(checked.success ? checked.data : undefined);
    }
  });
  it('permits finite controls and preference patches, rejects paths, generic methods and invalid values', () => {
    expect(parseControllerCommand({ kind: 'settings', patch: { autoNext: true } })).toBeDefined();
    for (const input of [
      { kind: 'settings', patch: { volume: .1 } }, { kind: 'settings', patch: { gamepadMap: {} } },
      { kind: 'settings', patch: { bilibiliMaxQuality: 999 } },
      { kind: 'play', handle: '/private/movie' }, { kind: 'cover', handle: 'https://evil.example' },
      { kind: 'player', session, command: { operation: 'seek', value: -1 } },
      { kind: 'player', session, command: { operation: 'rate', value: 20 } },
      { kind: 'catalog', collection: 'search', keyword: 'x'.repeat(201) },
      { kind: 'invoke', method: 'logout' },
    ]) expect(parseControllerCommand(input)).toBeUndefined();
    const settings = companionPreferences.parse(defaultPreferences);
    expect(settings).not.toHaveProperty('gamepadMap');
    expect(settings).not.toHaveProperty('volume');
    expect(companionReply.safeParse({ image: 'data:text/html;base64,AAAA' }).success).toBe(false);
  });

  it('exposes only registered display identities and revokes them on account changes', () => {
    const catalog = new CompanionCatalog();
    const item = { id: 'local:/private/movie', source: 'local' as const, kind: 'video' as const,
      title: '影片', path: '/private/movie', url: 'https://private/token' };
    const first = catalog.present({ items: [item], hasMore: false }).catalog!;
    const second = catalog.present({ items: [item], hasMore: false }).catalog!;
    expect(first.items[0].handle).toBe(second.items[0].handle);
    expect(JSON.stringify(first)).not.toContain('private');
    expect(catalog.get(first.items[0].handle)).toEqual(item);
    catalog.clear();
    expect(catalog.get(first.items[0].handle)).toBeUndefined();
  });

  it('checks session, busy state, next availability and actual quality/episode choices before actions', async () => {
    const state: CompanionPlayer = { session, title: '测试', live: false, paused: true, ended: false,
      busy: false, loading: false, error: '', position: 10, duration: 100, rate: 1,
      qualities: [{ id: 80, label: '1080P' }], parts: [], next: false, related: true };
    const toggle = vi.fn(), seek = vi.fn(), quality = vi.fn(async () => ({ error: 'failed' as const }));
    let blocked = false;
    const control = playerCompanion({ state, blocked: () => blocked, toggle, seek, quality,
      previous: vi.fn(), next: vi.fn(), rate: vi.fn(), stop: vi.fn(), retry: vi.fn(),
      episode: vi.fn(), transition: run => run() });
    expect(await control.control(session, { operation: 'next' })).toEqual({ error: 'unavailable' });
    expect(await control.control(session, { operation: 'quality', value: 120 })).toEqual({ error: 'unavailable' });
    expect(quality).not.toHaveBeenCalled();
    expect(await control.control(session, { operation: 'quality', value: 80 })).toEqual({ error: 'failed' });
    expect(await control.control(session, { operation: 'seek', value: 110 })).toEqual({ error: 'unavailable' });
    expect(seek).not.toHaveBeenCalled();
    expect(await control.control('old-session', { operation: 'toggle' })).toEqual({ error: 'canceled' });
    blocked = true;
    expect(await control.control(session, { operation: 'toggle' })).toEqual({ error: 'busy' });
    expect(toggle).not.toHaveBeenCalled();
    const replace = vi.fn();
    expect(await control.replace(replace)).toEqual({ error: 'busy' });
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not acknowledge a transition canceled before resolution or an unsuccessful open', async () => {
    const open = vi.fn(async () => 'opened' as const);
    expect(await companionTransition(async () => {}, open)).toEqual({ error: 'canceled' });
    expect(open).not.toHaveBeenCalled();
    expect(await companionTransition(run => run(), async () => 'failed')).toEqual({ error: 'failed' });
  });

  it('reads video related results in platform order without calling the homepage recommendation feed', async () => {
    const get = vi.fn(async () => [{ bvid: 'BV1xx411c7mD', aid: 2, title: '第二条' }, { aid: 1, title: '第一条' }]);
    const account = { http: { get } } as unknown as BilibiliAccount;
    const result = await relatedBilibili(account, { id: 'video', source: 'bilibili', kind: 'video', title: '标题', aid: 42 });
    expect(result.items.map(item => item.title)).toEqual(['第二条', '第一条']);
    expect(get).toHaveBeenCalledExactlyOnceWith('https://api.bilibili.com/x/web-interface/archive/related', { aid: 42 });
    await relatedBilibili(account, { id: 'live', source: 'bilibili', kind: 'live', title: '直播' });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
