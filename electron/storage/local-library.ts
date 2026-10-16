import type { LocalImportResult, MediaItem } from '../../src/shared/types';
import { scanLocal } from '../providers/local';
import type { Store } from './store';

interface Selection { canceled: boolean; filePaths: string[] }

function appendMedia(existing: MediaItem[], incoming: MediaItem[]) {
  const seen = new Set(existing.map(item => item.id));
  return [...existing, ...incoming.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  })];
}

/** Owns local discovery and commits, with the platform picker supplied by main. */
export class LocalLibrary {
  private busy = false;
  constructor(private store: Store, private scan = scanLocal) {}

  add(select: () => Promise<Selection>): Promise<LocalImportResult> {
    return this.exclusive(async () => {
      const selected = await select();
      if (selected.canceled) return { library: this.store.state.library, canceled: true, found: 0, added: 0 };
      const items = await this.scan(selected.filePaths);
      let added = 0;
      await this.store.update(state => {
        const library = appendMedia(state.library, items);
        added = library.length - state.library.length;
        return { ...state, roots: [...new Set([...state.roots, ...selected.filePaths])], library };
      });
      return { library: this.store.state.library, canceled: false, found: items.length, added };
    });
  }

  rescan() {
    return this.exclusive(async () => {
      const roots = [...this.store.state.roots];
      if (!roots.length) return this.store.state.library;
      const items = await this.scan(roots);
      await this.store.update(state => ({ ...state, library: appendMedia(state.library, items) }));
      return this.store.state.library;
    });
  }

  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('片库操作正在进行，请稍后重试');
    this.busy = true;
    try { return await run(); }
    finally { this.busy = false; }
  }
}
