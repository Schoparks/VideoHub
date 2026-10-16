import { createDanmakuLayout, visibleDanmaku, type DanmakuPlacement } from '../shared/danmaku-layout';
import type { DanmakuComment } from '../shared/types';

/** Keep only a bounded media-time window; a seek never measures the intervening movie. */
export function createDanmakuWindow(comments: DanmakuComment[], width: number, height: number,
  font: number, area: number, measure: (text: string) => number) {
  // Parser bounds each comment to 200 characters. This also covers slow reverse scrolling.
  const lookback = Math.max(4, (width + 200 * font * 2) / Math.max(40, width / 8));
  const ahead = 15;
  let place = createDanmakuLayout(width, height, font, area, measure);
  let placements: DanmakuPlacement[] = [];
  let index = 0;
  let previousTime = -Infinity;

  const reset = (time: number) => {
    place = createDanmakuLayout(width, height, font, area, measure);
    placements = [];
    let low = 0, high = comments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (comments[middle].time < time - lookback) low = middle + 1;
      else high = middle;
    }
    index = low;
  };

  return {
    prepare(time: number, budget = 2, maximum = 80) {
      const resetWindow = time < previousTime || time > previousTime + ahead;
      if (resetWindow) reset(time);
      const moved = time !== previousTime;
      previousTime = time;
      const deadline = performance.now() + budget;
      let count = 0;
      const start = index;
      while (index < comments.length && comments[index].time <= time + ahead
        && count++ < maximum && performance.now() < deadline) {
        const placement = place(comments[index++]);
        if (placement) placements.push(placement);
      }
      if (moved) placements = placements.filter(placement => placement.end > time);
      return resetWindow || start !== index;
    },
    visible: (time: number) => visibleDanmaku(placements, time, lookback),
  };
}
