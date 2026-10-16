import type { HistoryEntry, MediaItem } from '../../src/shared/types';
import { bilibiliIds } from '../../src/shared/bilibiliReference';

/** Read old PGC records with platform placeholders without weakening the IPC schema. */
export function restorePgcItem(item: MediaItem): MediaItem {
  return item.source === 'bilibili' && item.kind === 'season' ? { ...item, ...bilibiliIds(item) } : item;
}

export function restorePgcHistory(entry: HistoryEntry): HistoryEntry {
  if (entry.item.source !== 'bilibili' || entry.item.kind !== 'season') return entry;
  return {
    ...entry,
    item: restorePgcItem(entry.item),
    part: entry.part ? { ...entry.part, ...bilibiliIds(entry.part) } : undefined,
  };
}
