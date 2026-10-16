import { describe, expect, it } from 'vitest';
import { nextPlaybackTarget } from '../src/shared/playback-next';
import type { MediaItem, MediaPart, PlaybackSource } from '../src/shared/types';

const item: MediaItem = { id: 'video:a', source: 'bilibili', kind: 'video', title: 'A' };
const following: MediaItem = { ...item, id: 'video:b', title: 'B' };
const last: MediaItem = { ...item, id: 'video:c', title: 'C' };
const parts: MediaPart[] = [{ id: 'part:1', title: '第一集' }, { id: 'part:2', title: '第二集' }];
const source: PlaybackSource = {
  sessionId: 'session', item, part: parts[0], parts, url: 'https://example.com/video.mp4',
  format: 'file', startAt: 0, live: false,
};

describe('next playback availability and order', () => {
  it('finishes the current item episodes before using its following queue item', () => {
    expect(nextPlaybackTarget(source, [item, following])).toEqual({ kind: 'episode', part: parts[1] });
  });

  it('uses only the following queue item at the final episode', () => {
    expect(nextPlaybackTarget({ ...source, part: parts[1] }, [last, item, following]))
      .toEqual({ kind: 'queue', item: following });
  });

  it('still offers another episode when the item is outside the queue', () => {
    expect(nextPlaybackTarget(source, [following])).toEqual({ kind: 'episode', part: parts[1] });
  });

  it('does not restart or wrap a queue after the current item is last', () => {
    expect(nextPlaybackTarget({ ...source, part: parts[1] }, [following, item])).toBeUndefined();
  });

  it('does not choose the first queue item when the current item is absent', () => {
    expect(nextPlaybackTarget({ ...source, part: parts[1] }, [following, last])).toBeUndefined();
  });

  it('keeps missing episode data unresolved even if a queue item is known', () => {
    expect(nextPlaybackTarget({ ...source, parts: undefined }, [item, following])).toEqual({ kind: 'unknown' });
  });

  it('treats an explicitly empty episode list as known rather than requesting unknown data', () => {
    expect(nextPlaybackTarget({ ...source, parts: [] }, [item, following])).toEqual({ kind: 'queue', item: following });
    expect(nextPlaybackTarget({ ...source, parts: [] }, [])).toBeUndefined();
  });

  it('preserves the queue fallback when the active episode is not in the returned list', () => {
    expect(nextPlaybackTarget({ ...source, part: { id: 'absent', title: '未列出' } }, [item, following]))
      .toEqual({ kind: 'queue', item: following });
  });

  it('does not invent an episode identity for a source without a current part', () => {
    expect(nextPlaybackTarget({ ...source, part: undefined }, [item, following]))
      .toEqual({ kind: 'queue', item: following });
  });

  it('supports live queue succession and an absent source without creating seek or wrap behavior', () => {
    expect(nextPlaybackTarget({ ...source, live: true, part: undefined, parts: undefined }, [item, following]))
      .toEqual({ kind: 'queue', item: following });
    expect(nextPlaybackTarget(undefined, [item, following])).toBeUndefined();
  });
});
