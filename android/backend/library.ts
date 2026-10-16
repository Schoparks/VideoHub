import type { MediaItem, LocalImportResult } from '../../src/shared/types';
import type { Store } from './store';
import { native, nativeTask } from './native';

export class LocalLibrary {
  private busy = false;
  constructor(private store: Store) {}
  async add(directory: boolean): Promise<LocalImportResult> {
    return this.run(async () => {
      const selection = await nativeTask(id => native.select(id, directory));
      if (selection.canceled) return { library: this.store.state.library, canceled: true, found: 0, added: 0 };
      const items: MediaItem[] = selection.items;
      let added = 0;
      await this.store.update(state => {
        const incoming = items.filter(item => !state.library.some(saved => saved.id === item.id));
        added = incoming.length;
        return { ...state, library: [...state.library, ...incoming], roots: [...new Set([...state.roots, ...selection.roots])] };
      });
      return { library: this.store.state.library, canceled: false, found: items.length, added };
    });
  }
  async rescan() {
    return this.run(async () => {
      const items: MediaItem[] = await nativeTask(id => native.scan(id, JSON.stringify(this.store.state.roots)));
      await this.store.update(state => ({ ...state, library: [
        ...state.library, ...items.filter(item => !state.library.some(saved => saved.id === item.id)),
      ] }));
      return this.store.state.library;
    });
  }
  private async run<T>(action: () => Promise<T>) {
    if (this.busy) throw new Error('片库操作尚未结束');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
}
