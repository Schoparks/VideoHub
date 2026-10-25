import { api } from '../api';
import type { CompanionCommand } from '../shared/companion';
import type { ControllerReply } from '../shared/remote-control';
import type { Bootstrap } from '../shared/types';
import type { CollectionChange } from '../shared/collection-change';
import type { CompanionCatalog } from './companion-catalog';

/** Folder identities stay on the TV, with the same account lifetime as media handles. */
export class CompanionLibrary {
  private folders = new Map<string, number>();
  private generation = 0;
  clear() { this.folders.clear(); this.generation++; }

  async list(boot: Bootstrap): Promise<ControllerReply> {
    if (!boot.account.web) return { error: 'web-auth' };
    const generation = this.generation;
    const folders = await api.folders();
    if (generation !== this.generation) return { error: 'canceled' };
    if (folders.length > 1000) return { error: 'failed' };
    const previous = new Map([...this.folders].map(([handle, id]) => [id, handle]));
    this.folders.clear();
    return { folders: folders.map(folder => {
      const handle = previous.get(folder.id) || crypto.randomUUID();
      this.folders.set(handle, folder.id);
      return { handle, title: folder.title.slice(0, 500), count: folder.count };
    }) };
  }

  async browse(command: Extract<CompanionCommand, { kind: 'catalog' }>, boot: Bootstrap, catalog: CompanionCatalog): Promise<ControllerReply> {
    if (!boot.account.web) return { error: 'web-auth' };
    const id = this.folders.get(command.folder || '');
    if (!id) return { error: 'unavailable' };
    const generation = this.generation;
    const page = await api.browse({ kind: 'favorites', id, page: command.page, refresh: command.refresh });
    return generation === this.generation ? catalog.present(page) : { error: 'canceled' };
  }

  async edit(command: Extract<CompanionCommand, { kind: 'collection-edit' }>, boot: Bootstrap,
    catalog: CompanionCatalog, changed: (change: CollectionChange) => void): Promise<ControllerReply> {
    if (!boot.account.web) return { error: 'web-auth' };
    const item = catalog.get(command.handle);
    if (!item || item.source !== 'bilibili' || item.kind !== 'video') return { error: 'unavailable' };
    const generation = this.generation;
    const folderId = this.folders.get(command.folder || '');
    if (command.collection === 'favorites') {
      if (!folderId) return { error: 'unavailable' };
      await api.favorite(item, folderId, command.add);
    } else await api.watchLater(item, command.add);
    // The captured callback invalidates only the account which initiated the write.
    changed({ kind: command.collection, itemId: item.id, added: command.add, folderId });
    return generation === this.generation ? {} : { error: 'canceled' };
  }
}
