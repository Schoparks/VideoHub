import type { WebMediaCandidate } from './web-media-script';

/** Current page presentation outranks incidental requests; hidden-only media remain a fallback. */
export function selectWebMediaCandidate(
  network: readonly WebMediaCandidate[],
  page: readonly WebMediaCandidate[],
): WebMediaCandidate | undefined {
  const candidates = new Map<string, WebMediaCandidate>();
  for (const value of [...network, ...page]) {
    const previous = candidates.get(value.url);
    candidates.set(value.url, {
      ...previous,
      ...value,
      mime: value.mime || previous?.mime,
      score: Math.max(value.score, previous?.score ?? -Infinity),
      visibleArea: value.visibleArea === undefined ? previous?.visibleArea
        : Math.max(value.visibleArea, previous?.visibleArea ?? 0),
    });
  }
  const rank = (value: WebMediaCandidate) => value.visibleArea === undefined ? 1
    : value.visibleArea > 0 ? 2 : 0;
  return [...candidates.values()].sort((a, b) => rank(b) - rank(a)
    || (b.visibleArea ?? 0) - (a.visibleArea ?? 0) || b.score - a.score)[0];
}
