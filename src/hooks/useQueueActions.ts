import { useRef, useState } from 'react';
import { api, message } from '../api';
import type { MediaItem } from '../shared/types';

export function useQueueActions(items: MediaItem[], changed: (items: MediaItem[]) => void, notify: (text: string) => void) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const current = useRef(items); current.current = items;
  const update = async (next: MediaItem[]) => {
    if (pending.current) return false;
    pending.current = true; setBusy(true);
    try {
      await api.queue(next); current.current = next; changed(next);
      return true;
    } catch (error) {
      notify(message(error)); return false;
    } finally { pending.current = false; setBusy(false); }
  };
  const enqueue = async (item: MediaItem) => {
    if (current.current.some(existing => existing.id === item.id)) { notify('已在播放队列中'); return; }
    if (await update([...current.current, item])) notify('已加入播放队列');
  };
  return { busy, update, enqueue };
}
