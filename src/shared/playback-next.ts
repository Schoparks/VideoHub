import type { MediaItem, MediaPart, PlaybackSource } from './types';

export type NextPlaybackKind = 'episode' | 'queue' | 'unknown';
type NextPlaybackTarget = { kind: 'episode'; part: MediaPart }
  | { kind: 'queue'; item: MediaItem }
  | { kind: 'unknown' };

/** Preserve episode-first order; absent part data must be resolved, never guessed. */
export function nextPlaybackTarget(source: PlaybackSource | undefined, queue: readonly MediaItem[]): NextPlaybackTarget | undefined {
  if (!source) return;
  if (source.part) {
    if (!source.parts) return { kind: 'unknown' };
    const position = source.parts.findIndex(part => part.id === source.part?.id);
    if (position >= 0 && position < source.parts.length - 1) {
      return { kind: 'episode', part: source.parts[position + 1] };
    }
  }
  const index = queue.findIndex(item => item.id === source.item.id);
  if (index >= 0 && index < queue.length - 1) return { kind: 'queue', item: queue[index + 1] };
}
