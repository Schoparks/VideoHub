export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Rect { x: number; y: number; width: number; height: number }

export function nearest(origin: Rect, candidates: Rect[], direction: 'up' | 'down' | 'left' | 'right') {
  const vertical = direction === 'up' || direction === 'down';
  const sign = direction === 'up' || direction === 'left' ? -1 : 1;
  const center = (rect: Rect) => [rect.x + rect.width / 2, rect.y + rect.height / 2];
  const [ox, oy] = center(origin);
  let best = -1, score = Infinity;
  candidates.forEach((rect, index) => {
    const [x, y] = center(rect);
    const primary = ((vertical ? y : x) - (vertical ? oy : ox)) * sign;
    const cross = Math.abs((vertical ? x : y) - (vertical ? ox : oy));
    if (primary < 3) return;
    const overlap = vertical
      ? rect.x < origin.x + origin.width && rect.x + rect.width > origin.x
      : rect.y < origin.y + origin.height && rect.y + rect.height > origin.y;
    const value = primary + cross * 3 + (overlap ? 0 : 1000);
    if (value < score) { score = value; best = index; }
  });
  return best;
}
