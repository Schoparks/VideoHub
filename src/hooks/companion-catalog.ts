import { api } from '../api';
import type { CompanionCommand } from '../shared/companion';
import type { ControllerReply } from '../shared/remote-control';
import type { Bootstrap, BrowseKind, MediaItem, Page } from '../shared/types';
import { isBilibiliImageHost, thumbnailUrl } from '../shared/images';
import { CompanionDynamics } from './companion-dynamics';
const itemIdentity = (item: MediaItem) => `${item.source}:${item.id}:${item.cid || ''}:${item.episodeId || ''}`;

/** Session-local capabilities: the phone cannot supply paths, URLs or platform identities. */
export class CompanionCatalog {
  private items = new Map<string, MediaItem>();
  private identities = new Map<string, string>();
  private generation = 0;
  private dynamics = new CompanionDynamics();
  version() { return this.generation; }
  clear() { this.items.clear(); this.identities.clear(); this.dynamics.clear(); this.generation++; }
  get(handle: string) { return this.items.get(handle); }

  present(page: Page): ControllerReply {
    if (page.items.length > 2000) throw new Error('列表过长');
    const items = page.items.map(item => {
      const identity = itemIdentity(item);
      let handle = this.identities.get(identity);
      if (!handle) {
        handle = crypto.randomUUID();
        this.identities.set(identity, handle);
      }
      this.items.delete(handle);
      this.items.set(handle, item);
      while (this.items.size > 4000) {
        const oldest = this.items.keys().next().value!;
        const removed = this.items.get(oldest)!;
        this.identities.delete(itemIdentity(removed));
        this.items.delete(oldest);
      }
      const image = thumbnailUrl(item.cover, 160);
      return { handle, title: item.title.slice(0, 2000), author: item.author?.slice(0, 500), duration: item.duration,
        source: item.source, kind: item.kind, artwork: !!image && isBilibiliImageHost(new URL(image).hostname) };
    });
    const dynamics = page.dynamics ? this.dynamics.present(page.dynamics,
      item => this.present({ items: [item], hasMore: false }).catalog!.items[0]) : undefined;
    return { catalog: { items, dynamics, hasMore: page.hasMore, cursor: page.cursor } };
  }

  async browse(command: Extract<CompanionCommand, { kind: 'catalog' }>, boot: Bootstrap): Promise<ControllerReply> {
    const generation = this.generation;
    const { collection, category, kind: _kind, folder: _folder, ...query } = command;
    let page: Page;
    // Read persisted local history afresh without applying an old bootstrap to App preferences.
    const history = collection === 'localHistory' ? (await api.bootstrap()).history : undefined;
    const local = collection === 'local' ? boot.library : history
      ? history.map(entry => ({ ...entry.item, cid: entry.part?.cid ?? entry.item.cid,
        episodeId: entry.part?.episodeId ?? entry.item.episodeId })) : collection === 'queue' ? boot.queue : undefined;
    if (local) {
      const start = ((command.page || 1) - 1) * 48;
      page = { items: local.slice(start, start + 48), hasMore: start + 48 < local.length };
    } else {
      if (collection === 'recommend' && !boot.account.app) return { error: 'app-auth' };
      if (['history', 'watchlater', 'followingLive', 'dynamic', 'followingCinema'].includes(collection) && !boot.account.web) return { error: 'web-auth' };
      if (collection === 'search' && !command.keyword) return { error: 'failed' };
      page = await api.browse({ ...query, kind: collection as BrowseKind, id: category });
    }
    return generation === this.generation ? this.present(page) : { error: 'canceled' };
  }

  async cover(handle: string): Promise<ControllerReply> {
    const item = this.get(handle);
    const image = thumbnailUrl(item?.cover, 960) || this.dynamics.image(handle);
    if (!image || !isBilibiliImageHost(new URL(image).hostname)) return { error: 'unavailable' };
    const generation = this.generation;
    const origin = window.hubPlatform === 'android' ? 'https://app.yingji.local' : 'yingji://app';
    const response = await fetch(`${origin}/image?url=${encodeURIComponent(image)}`, { credentials: 'omit' });
    const blob = await response.blob();
    if (!response.ok || blob.size > 250000 || !/^image\/(jpeg|png|webp|avif|gif)$/.test(blob.type)) return { error: 'failed' };
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return generation === this.generation ? { image: data } : { error: 'canceled' };
  }
}
