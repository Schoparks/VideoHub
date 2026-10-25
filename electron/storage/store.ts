import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, type HistoryEntry, type MediaItem, type Preferences } from '../../src/shared/types';
import { restorePgcHistory, restorePgcItem } from './pgc-references';
import { restoreBilibiliQuality } from '../../src/shared/bilibili-quality';
export interface State { version: 1; library: MediaItem[]; roots: string[]; history: HistoryEntry[]; queue: MediaItem[]; preferences: Preferences }
export class Store {
  state: State = { version: 1, library: [], roots: [], history: [], queue: [], preferences: { ...defaultPreferences } };
  private pending: Promise<void> = Promise.resolve();
  notice?: string;
  constructor(readonly directory: string) {}
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      const data = JSON.parse(await readFile(join(this.directory, 'library.json'), 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.library) || !Array.isArray(data.history)) throw new Error('格式不正确');
      const restored: State = { ...this.state, ...data, preferences: { ...defaultPreferences, ...data.preferences } };
      Object.assign(restored.preferences, restoreBilibiliQuality(data.preferences));
      if (!Array.isArray(restored.queue) || !Array.isArray(restored.roots)) throw new Error('格式不正确');
      restored.history = restored.history.map(restorePgcHistory);
      restored.queue = restored.queue.map(restorePgcItem);
      this.state = restored;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        await rename(join(this.directory, 'library.json'), join(this.directory, `library.backup-${Date.now()}.json`));
        this.notice = '片库数据异常，已保留备份并启动空片库。';
      }
    }
  }
  /** Compute from the latest committed state; publish only after atomic persistence. */
  update(change: (state: State) => State) {
    const job = this.pending.catch(() => {}).then(async () => {
      const next = change(this.state);
      await this.write(JSON.stringify(next));
      this.state = next;
    });
    this.pending = job;
    return job;
  }
  private async write(content: string) {
    const file = join(this.directory, 'library.json');
    await writeFile(`${file}.tmp`, content, { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  record(entry: HistoryEntry) {
    const key = historyKey(entry.item, entry.part);
    return this.update(state => ({
      ...state,
      history: [entry, ...state.history.filter(x => historyKey(x.item, x.part) !== key)].slice(0, 500),
    }));
  }
}
export function historyKey(item: MediaItem, part?: HistoryEntry['part']) { return `${item.id}:${part?.id || item.cid || item.episodeId || ''}`; }
