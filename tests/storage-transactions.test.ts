import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../electron/storage/store';
import type { MediaItem } from '../src/shared/types';

const item: MediaItem = { id: 'local:fixture', source: 'local', kind: 'video', title: '样片' };

async function fixture(run: (store: Store) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'yingji-transaction-'));
  const store = new Store(directory);
  await store.init();
  try { await run(store); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

describe('atomic storage changes', () => {
  it('keeps committed settings and queue after a failed disk write, then recovers', async () => {
    await fixture(async store => {
      await store.update(state => ({ ...state, queue: [item] }));
      const previous = store.state;
      const file = join(store.directory, 'library.json');
      const original = await readFile(file, 'utf8');
      // A directory at the staging-file path simulates a real write failure on all OSes.
      await mkdir(`${file}.tmp`);
      await expect(store.update(state => ({ ...state, queue: [] }))).rejects.toThrow();
      await expect(store.update(state => ({
        ...state, preferences: { ...state.preferences, theme: 'dark' },
      }))).rejects.toThrow();
      expect(store.state).toBe(previous);
      expect(await readFile(file, 'utf8')).toBe(original);
      await rm(`${file}.tmp`, { recursive: true });
      await store.update(state => ({ ...state, preferences: { ...state.preferences, theme: 'dark' } }));
      const reopened = new Store(store.directory);
      await reopened.init();
      expect(reopened.state.queue).toEqual([item]);
      expect(reopened.state.preferences.theme).toBe('dark');
    });
  });

  it('combines concurrent history, queue, preferences and library updates without losing fields', async () => {
    await fixture(async store => {
      await Promise.all([
        store.record({ item, position: 48, duration: 100, updatedAt: 1 }),
        store.update(state => ({ ...state, queue: [item] })),
        store.update(state => ({ ...state, preferences: { ...state.preferences, tvMode: true } })),
        store.update(state => ({ ...state, library: [item], roots: ['fixture'] })),
      ]);
      const persisted = JSON.parse(await readFile(join(store.directory, 'library.json'), 'utf8'));
      expect(persisted).toEqual(store.state);
      expect(persisted.history[0].position).toBe(48);
      expect(persisted.queue).toEqual([item]);
      expect(persisted.preferences.tvMode).toBe(true);
      expect(persisted.library).toEqual([item]);
      expect(persisted.roots).toEqual(['fixture']);
    });
  });

  it('publishes no new state while persistence is waiting', async () => {
    await fixture(async store => {
      const previous = store.state;
      const updating = store.update(state => ({ ...state, queue: [item] }));
      expect(store.state).toBe(previous);
      await updating;
      expect(store.state.queue).toEqual([item]);
    });
  });

  it('retains backward seeks and separate episode progress under concurrent records', async () => {
    await fixture(async store => {
      await Promise.all([
        store.record({ item, part: { id: 'one', title: '一' }, position: 90, duration: 100, updatedAt: 1 }),
        store.record({ item, part: { id: 'two', title: '二' }, position: 25, duration: 100, updatedAt: 2 }),
        store.record({ item, part: { id: 'one', title: '一' }, position: 5, duration: 100, updatedAt: 3 }),
      ]);
      expect(store.state.history.map(entry => [entry.part?.id, entry.position])).toEqual([['one', 5], ['two', 25]]);
    });
  });

  it('keeps a valid empty state after a partially corrupt file is backed up', async () => {
    await fixture(async store => {
      await writeFile(join(store.directory, 'library.json'), JSON.stringify({
        version: 1, library: [item], history: [], queue: null, roots: [], preferences: { theme: 'dark' },
      }));
      const reopened = new Store(store.directory);
      await reopened.init();
      expect(reopened.state.library).toEqual([]);
      expect(reopened.state.queue).toEqual([]);
      expect(reopened.state.preferences.theme).toBe('light');
      expect(reopened.notice).toContain('已保留备份');
    });
  });
});
