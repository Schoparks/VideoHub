import { describe, expect, it } from 'vitest';
import { selectWebMediaCandidate } from '../electron/providers/web-media-selection';
import type { WebMediaCandidate } from '../electron/providers/web-media-script';

const candidate = (name: string, score: number, visibleArea?: number): WebMediaCandidate => ({
  url: `https://media.example/${name}.mp4`, referer: 'https://small.example/watch', score, visibleArea,
});

describe('webpage primary media selection', () => {
  it('prefers declared primary metadata over a known hidden video even after a successful network request', () => {
    const ad = candidate('ad', 1000, 0), main = candidate('main', 600);
    expect(selectWebMediaCandidate([candidate('ad', 900)], [ad, main])?.url).toBe(main.url);
  });

  it('uses visible player area instead of document or request order when scores are capped equally', () => {
    const small = candidate('small', 1100, 1000000), large = candidate('large', 1100, 1280000);
    expect(selectWebMediaCandidate([small, large], [small, large])?.url).toBe(large.url);
    expect(selectWebMediaCandidate([], [large, small])?.url).toBe(large.url);
  });

  it('prefers visible player media over unrelated adaptive requests, preserving source MIME and frame referer', () => {
    const main = { ...candidate('main', 1000, 230400), referer: 'https://embed.example/watch' };
    const detected = { ...candidate('main', 750), mime: 'video/webm' };
    expect(selectWebMediaCandidate([candidate('incidental', 900), detected], [main]))
      .toMatchObject({ url: main.url, mime: 'video/webm', referer: main.referer });
  });

  it('retains network-only adaptive detection for blob players and hidden-only sources as a last fallback', () => {
    const hidden = candidate('hidden', 1100, 0), adaptive = candidate('adaptive', 900);
    expect(selectWebMediaCandidate([candidate('segment', 150), adaptive], [])?.url).toBe(adaptive.url);
    expect(selectWebMediaCandidate([], [hidden])?.url).toBe(hidden.url);
    expect(selectWebMediaCandidate([], [])).toBeUndefined();
  });

  it('combines duplicate player evidence by maximum visible area, without mutating input snapshots', () => {
    const hidden = candidate('same', 1000, 0), visible = candidate('same', 1050, 230400);
    const result = selectWebMediaCandidate([], [visible, hidden]);
    expect(result).toMatchObject({ score: 1050, visibleArea: 230400 });
    expect(hidden.visibleArea).toBe(0);
    expect(selectWebMediaCandidate([], [hidden, visible])).toEqual(result);
  });

  it('replaces old visible player evidence when the next page snapshot hides it', () => {
    const network = [candidate('old', 900)];
    expect(selectWebMediaCandidate(network, [candidate('old', 1100, 1500000)])?.visibleArea).toBe(1500000);
    const current = candidate('current', 600);
    expect(selectWebMediaCandidate(network, [candidate('old', 1000, 0), current])?.url).toBe(current.url);
  });
});
