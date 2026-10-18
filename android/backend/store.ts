import { defaultPreferences, type HistoryEntry, type MediaItem } from '../../src/shared/types';
import type { State } from '../../electron/storage/store';
import { restorePgcHistory, restorePgcItem } from '../../electron/storage/pgc-references';
import { native, persist } from './native';
export function historyKey(item: MediaItem, part?: HistoryEntry['part']) { return `${item.id}:${part?.id || item.cid || item.episodeId || ''}`; }

export class Store {
  state: State = {
    version: 1, library: [], roots: [], history: [], queue: [],
    preferences: { ...defaultPreferences, tvMode: true, theme: 'dark' },
  };
  private pending = Promise.resolve();
  notice?: string;
  async init() {
    const raw = native.read('library');
    if (!raw) return;
    try {
      const value = JSON.parse(raw);
      if (value.version !== 1 || !['library', 'roots', 'history', 'queue'].every(key => Array.isArray(value[key]))) throw new Error();
      this.state = { ...value, preferences: { ...this.state.preferences, ...value.preferences } };
      this.state.history = this.state.history.map(restorePgcHistory);
      this.state.queue = this.state.queue.map(restorePgcItem);
    } catch {
      const error = native.write('backup', raw);
      if (error) throw new Error(error);
      this.notice = '片库数据异常，已保留备份并启动空片库。';
    }
  }
  update(change: (state: State) => State) {
    const job = this.pending.catch(() => {}).then(() => {
      const next = change(this.state);
      persist('library', next);
      this.state = next;
    });
    this.pending = job;
    return job;
  }
  record(entry: HistoryEntry) {
    const key = (value: HistoryEntry) => `${value.item.id}:${value.part?.id || value.item.cid || value.item.episodeId || ''}`;
    return this.update(state => ({ ...state, history: [entry, ...state.history.filter(value => key(value) !== key(entry))].slice(0, 500) }));
  }
}
