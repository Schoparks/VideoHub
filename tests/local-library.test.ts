import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { LocalLibrary } from '../electron/storage/local-library';
import { Store } from '../electron/storage/store';
import type { MediaItem } from '../src/shared/types';

const media = (id: string): MediaItem => ({ id, source: 'local', kind: 'video', title: id, path: `/${id}.mp4` });
const select = (filePaths = ['fixture-directory']) => async () => ({ canceled: false, filePaths });

async function fixture(run: (store: Store, path: string) => Promise<void>) {
  const base = resolve('.tmp');
  await mkdir(base, { recursive: true });
  const path = await mkdtemp(join(base, 'local-library-test-'));
  try {
    const store = new Store(join(path, 'profile'));
    await store.init();
    await run(store, path);
  } finally {
    if (!resolve(path).startsWith(base + sep)) throw new Error('Invalid test cleanup path');
    await rm(path, { recursive: true, force: true });
  }
}

describe('local library operations', () => {
  it('discovers real files, persists authorized roots and preserves idempotent identity', async () => {
    await fixture(async (store, path) => {
      const folder = join(path, 'media');
      await mkdir(folder);
      await writeFile(join(folder, '电影.mp4'), 'fixture');
      await writeFile(join(folder, 'ignore.txt'), 'fixture');
      const library = new LocalLibrary(store);
      const added = await library.add(select([folder]));
      expect(added).toMatchObject({ canceled: false, found: 1, added: 1 });
      expect(added.library[0].title).toBe('电影');
      expect(store.state.roots).toEqual([folder]);
      expect(await library.add(select([folder]))).toMatchObject({ found: 1, added: 0 });
      await writeFile(join(folder, '第二项.webm'), 'fixture');
      expect(await library.rescan()).toHaveLength(2);
      const restored = new Store(store.directory);
      await restored.init();
      expect(restored.state.library.map(item => item.id)).toEqual(store.state.library.map(item => item.id));
      expect(restored.state.roots).toEqual([folder]);
    });
  });

  it('returns cancellation without scanning or committing', async () => {
    await fixture(async store => {
      await store.update(state => ({ ...state, library: [media('existing')] }));
      const before = await readFile(join(store.directory, 'library.json'), 'utf8');
      let scans = 0;
      const library = new LocalLibrary(store, async () => { scans++; return []; });
      expect(await library.add(async () => ({ canceled: true, filePaths: [] }))).toEqual({
        canceled: true, found: 0, added: 0, library: [media('existing')],
      });
      expect(scans).toBe(0);
      expect(await readFile(join(store.directory, 'library.json'), 'utf8')).toBe(before);
    });
  });

  it('guards the picker and scanning against concurrent import or rescan', async () => {
    await fixture(async store => {
      let finish!: (selection: { canceled: boolean; filePaths: string[] }) => void;
      const library = new LocalLibrary(store, async () => [media('first')]);
      const adding = library.add(() => new Promise(resolve => { finish = resolve; }));
      await expect(library.rescan()).rejects.toThrow('正在进行');
      await expect(library.add(select())).rejects.toThrow('正在进行');
      finish({ canceled: false, filePaths: ['fixture-directory'] });
      await adding;
      expect(await library.rescan()).toHaveLength(1);
    });
  });

  it('releases its guard after scan failure and preserves committed data and roots', async () => {
    await fixture(async store => {
      await store.update(state => ({ ...state, library: [media('old')], roots: ['old-root'] }));
      let fail = true;
      const library = new LocalLibrary(store, async () => {
        if (fail) throw new Error('目录不可读取');
        return [media('new')];
      });
      await expect(library.add(select())).rejects.toThrow('不可读取');
      expect(store.state.library).toEqual([media('old')]);
      expect(store.state.roots).toEqual(['old-root']);
      fail = false;
      expect(await library.add(select())).toMatchObject({ added: 1, found: 1 });
      expect(store.state.library).toEqual([media('old'), media('new')]);
    });
  });

  it('preserves the library on inaccessible roots and does not remove unavailable files', async () => {
    await fixture(async (store, path) => {
      await store.update(state => ({ ...state, library: [media('old')], roots: [join(path, 'missing')] }));
      const library = new LocalLibrary(store);
      await expect(library.rescan()).rejects.toThrow();
      expect(store.state.library).toEqual([media('old')]);
    });
  });

  it('does not publish success or new roots on failed persistence and can retry', async () => {
    await fixture(async store => {
      const temporary = join(store.directory, 'library.json.tmp');
      await mkdir(temporary);
      const library = new LocalLibrary(store, async () => [media('new')]);
      await expect(library.add(select())).rejects.toThrow();
      expect(store.state.library).toEqual([]);
      expect(store.state.roots).toEqual([]);
      await rm(temporary, { recursive: true });
      expect(await library.add(select())).toMatchObject({ added: 1 });
    });
  });

  it('merges from the committed state without discarding settings changed during a scan', async () => {
    await fixture(async store => {
      let finish!: (items: MediaItem[]) => void;
      const library = new LocalLibrary(store, () => new Promise(resolve => { finish = resolve; }));
      const adding = library.add(select());
      await Promise.resolve();
      await store.update(state => ({ ...state, queue: [media('queued')], preferences: { ...state.preferences, volume: .3 } }));
      finish([media('new'), media('new')]);
      expect(await adding).toMatchObject({ found: 2, added: 1 });
      expect(store.state.queue).toEqual([media('queued')]);
      expect(store.state.preferences.volume).toBe(.3);
    });
  });

  it('retains a selected empty directory for subsequent rescans without inventing media', async () => {
    await fixture(async store => {
      const library = new LocalLibrary(store, async () => []);
      expect(await library.add(select())).toEqual({ library: [], canceled: false, found: 0, added: 0 });
      expect(store.state.roots).toEqual(['fixture-directory']);
      expect(await library.rescan()).toEqual([]);
    });
  });
});
