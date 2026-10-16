import type { DanmakuPlacement } from '../shared/danmaku-layout';
import { createMediaTranslation } from './media-translation';

/** Non-overlapping text in one lane has the same velocity and needs only one animation. */
export function createDanmakuLanes(host: HTMLElement, video: HTMLVideoElement, width: number) {
  const groups = new Map<string, {
    node: HTMLDivElement;
    anchor: number;
    motion: ReturnType<typeof createMediaTranslation>;
    entries: Map<string, { node: HTMLSpanElement; comment: DanmakuPlacement }>;
  }>();
  const key = (comment: DanmakuPlacement) => `${comment.mode}:${comment.y}`;
  const move = (node: HTMLElement, comment: DanmakuPlacement, anchor: number) =>
    createMediaTranslation(node, 0, (comment.mode === 1 ? -1 : 1) * comment.speed * 16,
      comment.y, anchor, anchor + 16, video);
  const position = (node: HTMLElement, comment: DanmakuPlacement, anchor: number) => {
    const offset = (comment.time - anchor) * comment.speed;
    node.style.left = `${comment.mode === 1 ? width + offset : -comment.width - offset}px`;
  };
  return {
    add(node: HTMLSpanElement, comment: DanmakuPlacement, time: number) {
      const id = key(comment);
      let group = groups.get(id);
      if (!group) {
        const container = document.createElement('div');
        container.className = 'danmaku-lane';
        host.append(container);
        group = { node: container, anchor: time, motion: move(container, comment, time), entries: new Map() };
        groups.set(id, group);
      }
      position(node, comment, group.anchor);
      group.node.append(node);
      group.entries.set(comment.id, { node, comment });
    },
    remove(comment: DanmakuPlacement) {
      const id = key(comment), group = groups.get(id);
      if (!group) return;
      group.entries.delete(comment.id);
      if (!group.entries.size) {
        group.motion.stop();
        group.node.remove();
        groups.delete(id);
      }
    },
    update(time: number, force: boolean) {
      for (const group of groups.values()) {
        // Bound raster coordinates during hours of uninterrupted playback.
        if (time < group.anchor || time - group.anchor >= 8) {
          group.motion.stop();
          group.anchor = time;
          const first = group.entries.values().next().value!;
          group.motion = move(group.node, first.comment, time);
          group.entries.forEach(entry => position(entry.node, entry.comment, time));
        }
        group.motion.update(time, force);
      }
    },
    stop() {
      groups.forEach(group => { group.motion.stop(); group.node.remove(); });
      groups.clear();
    },
  };
}
