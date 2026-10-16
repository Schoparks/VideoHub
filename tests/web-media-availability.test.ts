import { describe, expect, it } from 'vitest';
import { WebMediaAvailability } from '../electron/providers/web-media-availability';

const media = 'https://media.example/video.mp4?version=1';

describe('observed webpage media availability', () => {
  it('excludes current 404/410 responses regardless of fragment, without conflating query versions', () => {
    const state = new WebMediaAvailability();
    for (const status of [404, 410]) {
      state.observe(1, media, status);
      expect(state.isUnavailable(`${media}#t=2`)).toBe(true);
      expect(state.isUnavailable(media.replace('version=1', 'version=2'))).toBe(false);
    }
  });

  it('restores a resource when its later response changes, preserving permission/transient failures as unknown', () => {
    const state = new WebMediaAvailability();
    for (const status of [200, 206, 401, 403, 500, 503]) {
      state.observe(1, media, 404);
      state.observe(2, media, status);
      expect(state.isUnavailable(media)).toBe(false);
    }
  });

  it('applies final redirect failure and recovery to original and intermediate addresses by request identity', () => {
    const state = new WebMediaAvailability();
    const intermediate = 'https://small.example/redirect.mp4';
    const target = 'https://cdn.example/missing';
    state.redirect(1, media, intermediate);
    state.redirect(1, intermediate, target);
    state.observe(1, intermediate, 302);
    expect(state.hasRedirect(1)).toBe(true);
    state.observe(1, target, 410);
    for (const url of [media, intermediate, target]) expect(state.isUnavailable(url)).toBe(true);
    expect(state.hasRedirect(1)).toBe(false);
    state.redirect(2, media, intermediate);
    state.redirect(2, intermediate, target);
    state.observe(2, target, 206);
    for (const url of [media, intermediate, target]) expect(state.isUnavailable(url)).toBe(false);
  });

  it('isolates simultaneous redirect chains and does not let unrelated success erase a failure', () => {
    const state = new WebMediaAvailability();
    const other = 'https://media.example/other.mp4';
    state.redirect(1, media, 'https://cdn.example/missing.mp4');
    state.redirect(2, other, 'https://cdn.example/other.mp4');
    state.observe(1, 'https://cdn.example/missing.mp4', 404);
    state.observe(2, 'https://cdn.example/other.mp4', 200);
    expect(state.isUnavailable(media)).toBe(true);
    expect(state.isUnavailable(other)).toBe(false);
  });

  it('ignores forbidden resource identities and clears all evidence on release', () => {
    const state = new WebMediaAvailability();
    for (const url of ['file:///secret.mp4', 'https://user:password@media.example/video.mp4']) {
      state.observe(1, url, 404);
      expect(state.isUnavailable(url)).toBe(false);
    }
    state.observe(2, media, 404);
    state.redirect(3, media, 'https://cdn.example/video.mp4');
    state.clear();
    expect(state.isUnavailable(media)).toBe(false);
    expect(state.hasRedirect(3)).toBe(false);
  });
});
