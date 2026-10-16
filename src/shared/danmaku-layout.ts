import type { DanmakuComment } from './types';

export interface DanmakuPlacement extends DanmakuComment {
  y: number;
  width: number;
  end: number;
  speed: number;
}

export function createDanmakuLayout(width: number, height: number, fontSize: number,
  area: number, measure: (text: string) => number) {
  const rowHeight = Math.ceil(fontSize * 1.4);
  const count = Math.min(18, Math.max(1, Math.floor((height * area - 24) / rowHeight)));
  const lanes = Array.from({ length: count }, () => ({ clear: 0, end: 0, mode: 0 }));
  const speed = Math.max(40, width / 8);
  return (comment: DanmakuComment): DanmakuPlacement | undefined => {
    const fixed = comment.mode === 4 || comment.mode === 5;
    const order = comment.mode === 4 ? lanes.map((_, index) => count - index - 1) : lanes.map((_, index) => index);
    const index = order.find(index => {
      const lane = lanes[index];
      return (fixed || lane.mode !== comment.mode ? lane.end : lane.clear) <= comment.time;
    });
    if (index === undefined) return;
    const textWidth = measure(comment.text);
    const end = comment.time + (fixed ? 4 : (width + textWidth) / speed);
    lanes[index] = { clear: fixed ? end : comment.time + (textWidth + 30) / speed, end, mode: comment.mode };
    return { ...comment, y: 12 + index * rowHeight, width: textWidth, end, speed };
  };
}

export function layoutDanmaku(comments: DanmakuComment[], width: number, height: number, fontSize: number,
  area: number, measure: (text: string) => number): DanmakuPlacement[] {
  const place = createDanmakuLayout(width, height, fontSize, area, measure);
  const placements: DanmakuPlacement[] = [];
  for (const comment of comments) {
    const placement = place(comment);
    if (placement) placements.push(placement);
  }
  return placements;
}

export function visibleDanmaku(placements: DanmakuPlacement[], time: number, lookback = Infinity) {
  // Locate the earliest potentially visible comment without scanning the full pool per frame.
  let low = 0, high = placements.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (placements[middle].time < time - lookback) low = middle + 1;
    else high = middle;
  }
  const visible: DanmakuPlacement[] = [];
  for (let index = low; index < placements.length && placements[index].time <= time; index++) {
    if (placements[index].end > time) visible.push(placements[index]);
  }
  return visible;
}
