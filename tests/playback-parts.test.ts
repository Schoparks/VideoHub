import { describe, expect, it } from 'vitest';
import { withKnownPlaybackParts } from '../src/shared/playback-parts';
import type { PlaybackSource } from '../src/shared/types';

const parts = [{ id: 'part:1', title: '第一集' }, { id: 'part:2', title: '第二集' }];
const previous: PlaybackSource = {
  sessionId: 'old', item: { id: 'a', source: 'bilibili', kind: 'video', title: 'A' },
  part: parts[0], parts, url: 'https://example.com/old', format: 'file', startAt: 0, live: false,
};
const next: PlaybackSource = {
  ...previous, sessionId: 'new', part: parts[1], parts: undefined,
  url: 'https://example.com/new', quality: 64, startAt: 18,
};

describe('confirmed playback episode metadata', () => {
  it('retains known parts for the same item while preserving the newly resolved session and output', () => {
    expect(withKnownPlaybackParts(next, previous)).toEqual({ ...next, parts });
    expect(next.parts).toBeUndefined();
    expect(previous.sessionId).toBe('old');
  });

  it('gives an explicit provider list priority over previously known parts', () => {
    const authoritative = { ...next, parts: [parts[1]] };
    expect(withKnownPlaybackParts(authoritative, previous)).toBe(authoritative);
  });

  it('preserves an explicit empty provider list', () => {
    const authoritative = { ...next, parts: [] };
    expect(withKnownPlaybackParts(authoritative, previous)).toBe(authoritative);
  });

  it('does not transfer metadata to another item with the same part identity', () => {
    const other = { ...next, item: { ...next.item, id: 'b' } };
    expect(withKnownPlaybackParts(other, previous)).toBe(other);
  });

  it('does not transfer metadata across sources with overlapping IDs', () => {
    const other: PlaybackSource = { ...next, item: { ...next.item, source: 'local' } };
    expect(withKnownPlaybackParts(other, previous)).toBe(other);
  });

  it('does not assume an unknown active episode belongs to the old list', () => {
    const unknown = { ...next, part: { id: 'part:3', title: '新增分集' } };
    expect(withKnownPlaybackParts(unknown, previous)).toBe(unknown);
  });

  it('keeps sources without an active part or known predecessor unchanged', () => {
    const withoutPart = { ...next, part: undefined };
    expect(withKnownPlaybackParts(withoutPart, previous)).toBe(withoutPart);
    expect(withKnownPlaybackParts(next)).toBe(next);
    expect(withKnownPlaybackParts(next, { ...previous, parts: undefined })).toBe(next);
  });
});
