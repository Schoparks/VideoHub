import { useRef } from 'react';
import { api, message } from '../api';
import type { Preferences } from '../shared/types';

export function usePreferences(value: Preferences, changed: (value: Preferences) => void, notify: (text: string) => void) {
  const saved = useRef(value);
  const sequence = useRef(Promise.resolve());
  const revision = useRef(0);
  const pending = useRef(0);
  // An idle authoritative refresh also becomes the rollback base.
  if (!pending.current) saved.current = value;
  const change = (next: Preferences) => {
    let success = false;
    const token = ++revision.current;
    pending.current++;
    changed(next);
    sequence.current = sequence.current.then(async () => {
      const previous = saved.current;
      try {
        await api.preferences(next);
        saved.current = next;
        success = true;
      } catch (error) {
        if (token === revision.current) changed(saved.current);
        notify(message(error));
        return;
      }
      if (previous.tvMode !== next.tvMode) {
        try {
          await api.fullscreen(next.tvMode);
        } catch (error) {
          notify(message(error));
        }
      }
    }).finally(() => { pending.current--; });
    return sequence.current.then(() => success);
  };
  const settled = async () => {
    // Include writes queued while an earlier save is still in flight.
    let current;
    do {
      current = sequence.current;
      await current;
    } while (current !== sequence.current);
  };
  return { change, settled, isPending: () => pending.current > 0 };
}
