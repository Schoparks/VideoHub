import type { DanmakuPlacement } from '../shared/danmaku-layout';
import { createMediaTranslation } from './media-translation';

/** Individual/fixed text fallback; scrolling lanes share the same media-clock contract. */
export function createDanmakuMotion(node: HTMLSpanElement, comment: DanmakuPlacement,
  width: number, video: HTMLVideoElement) {
  const from = comment.mode === 1 ? width : comment.mode === 6 ? -comment.width : (width - comment.width) / 2;
  const to = comment.mode === 1 ? -comment.width : comment.mode === 6 ? width : from;
  return createMediaTranslation(node, from, to, comment.y, comment.time, comment.end, video);
}
