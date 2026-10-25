import type { DynamicItem, MediaItem } from '../shared/types';
import type { CompanionCard, CompanionDynamic } from '../shared/companion';
import { isBilibiliImageHost, thumbnailUrl } from '../shared/images';

/** Read-only artwork capabilities never enter the playable-media registry. */
export class CompanionDynamics {
  private entries = new Map<string, string>();
  private images = new Map<string, string>();
  clear() { this.entries.clear(); this.images.clear(); }
  image(handle: string) { return this.images.get(handle); }
  present(entries: DynamicItem[], video: (item: MediaItem) => CompanionCard): CompanionDynamic[] {
    return entries.map(entry => {
      let handle = this.entries.get(entry.id);
      if (!handle) { handle = crypto.randomUUID(); this.entries.set(entry.id, handle); }
      const blocks: CompanionDynamic['blocks'] = [];
      for (let body: DynamicItem | undefined = entry; body; body = body.original) {
        if (blocks.length >= 16 || body.text.length > 100000 || body.images.length > 100) throw new Error('动态内容过长');
        const images = body.images.flatMap(address => {
          const url = thumbnailUrl(address, 960);
          if (!url || !isBilibiliImageHost(new URL(url).hostname)) return [];
          let image = [...this.images].find(([, value]) => value === url)?.[0];
          if (!image) { image = crypto.randomUUID(); this.images.set(image, url); }
          return [image];
        });
        blocks.push({ author: body.author.slice(0, 500), text: body.text, images, video: body.video ? video(body.video) : undefined });
      }
      while (this.entries.size > 4000) this.entries.delete(this.entries.keys().next().value!);
      while (this.images.size > 4000) this.images.delete(this.images.keys().next().value!);
      return { handle, blocks };
    });
  }
}
