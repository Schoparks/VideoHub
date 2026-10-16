import type { HistoryEntry } from './types';

/** Keep the existing final-ten-seconds restart policy consistent with browse labels. */
export function resumePosition(entry?: Pick<HistoryEntry, 'position' | 'duration'>) {
  return entry && (entry.duration === 0 || entry.position < entry.duration - 10) ? entry.position : 0;
}
