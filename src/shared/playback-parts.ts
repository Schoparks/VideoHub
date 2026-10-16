import type { PlaybackSource } from './types';

/** Retain confirmed episode metadata only within the same active media item. */
export function withKnownPlaybackParts(next: PlaybackSource, previous?: PlaybackSource): PlaybackSource {
  if (next.parts !== undefined || !next.part || !previous?.parts
    || next.item.id !== previous.item.id || next.item.source !== previous.item.source
    || !previous.parts.some(part => part.id === next.part?.id)) return next;
  return { ...next, parts: previous.parts };
}
