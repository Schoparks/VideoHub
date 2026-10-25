import { describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { CompanionCatalog } from '../src/hooks/companion-catalog';
import { CompanionLibrary } from '../src/hooks/companion-library';
import { editCompanionQueue } from '../src/hooks/companion-queue';
import { defaultPreferences, type Bootstrap, type MediaItem } from '../src/shared/types';

vi.mock('../src/api', () => ({ api: { folders: vi.fn(), browse: vi.fn(), favorite: vi.fn(), watchLater: vi.fn() } }));
const item: MediaItem = { id: 'bili:fixture', source: 'bilibili', kind: 'video', title: '测试', aid: 42 };
const boot: Bootstrap = { account: { app: true, web: true, storage: 'memory' }, library: [], queue: [],
  history: [], preferences: defaultPreferences, version: 'test', platform: 'test' };
const register = (catalog: CompanionCatalog, items = [item]) => catalog.present({ items, hasMore: false }).catalog!.items;

describe('phone library capabilities', () => {
  it('uses issued folder handles, denies forged identities and revokes handles with the account', async () => {
    const library = new CompanionLibrary(), catalog = new CompanionCatalog();
    const [card] = register(catalog);
    vi.mocked(api.folders).mockResolvedValue([{ id: 1, title: '收藏夹', count: 1 }]);
    const result = await library.list(boot);
    expect(result.folders![0]).not.toHaveProperty('id');
    const command = { kind: 'collection-edit' as const, collection: 'favorites' as const, handle: card.handle,
      folder: result.folders![0].handle, add: true };
    const changed = vi.fn();
    expect(await library.edit(command, boot, catalog, changed)).toEqual({});
    expect(api.favorite).toHaveBeenLastCalledWith(item, 1, true);
    expect(changed).toHaveBeenCalledExactlyOnceWith({ kind: 'favorites', itemId: item.id, folderId: 1, added: true });
    expect(await library.edit({ ...command, folder: 'unissued' }, boot, catalog, changed)).toEqual({ error: 'unavailable' });
    library.clear();
    expect(await library.edit(command, boot, catalog, changed)).toEqual({ error: 'unavailable' });
    expect(await library.list({ ...boot, account: { ...boot.account, web: false } })).toEqual({ error: 'web-auth' });
  });

  it('rejects late folder reads and never reports a failed collection write as confirmed', async () => {
    const library = new CompanionLibrary(), catalog = new CompanionCatalog();
    let finish!: (value: Awaited<ReturnType<typeof api.folders>>) => void;
    vi.mocked(api.folders).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = library.list(boot);
    library.clear(); finish([{ id: 9, title: '旧账号', count: 0 }]);
    expect(await pending).toEqual({ error: 'canceled' });
    const [card] = register(catalog), changed = vi.fn();
    vi.mocked(api.watchLater).mockRejectedValueOnce(new Error('failed'));
    await expect(library.edit({ kind: 'collection-edit', collection: 'watchlater', handle: card.handle, add: true },
      boot, catalog, changed)).rejects.toThrow('failed');
    expect(changed).not.toHaveBeenCalled();
  });

  it('edits only the resolved queue item, preserves order, deduplicates and propagates failed saves', async () => {
    const catalog = new CompanionCatalog();
    const other = { ...item, id: 'bili:second' }, queue = [item, other];
    const [card] = register(catalog), update = vi.fn(async () => true);
    const command = { kind: 'queue-edit' as const, handle: card.handle, operation: 'down' as const };
    expect(await editCompanionQueue(command, queue, catalog, update)).toEqual({});
    expect(update).toHaveBeenLastCalledWith([other, item]);
    expect(queue).toEqual([item, other]);
    update.mockClear();
    await editCompanionQueue({ ...command, operation: 'add' }, queue, catalog, update);
    expect(update).not.toHaveBeenCalled();
    update.mockResolvedValueOnce(false);
    expect(await editCompanionQueue({ ...command, operation: 'remove' }, queue, catalog, update)).toEqual({ error: 'failed' });
    expect(update).toHaveBeenLastCalledWith([other]);
    catalog.clear(); update.mockClear();
    expect(await editCompanionQueue(command, queue, catalog, update)).toEqual({ error: 'unavailable' });
    expect(update).not.toHaveBeenCalled();
  });
});
