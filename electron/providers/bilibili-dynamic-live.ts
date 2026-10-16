import type { MediaItem } from '../../src/shared/types';
import { normalizeLive } from './bilibili-live';

/** Dynamic live notices embed the room data in a JSON string, not an archive. */
export function normalizeDynamicLive(major: any, author: string): MediaItem | undefined {
  let value = major.live;
  const content = major.live_rcmd?.content;
  if (content !== undefined) {
    try {
      if (typeof content === 'string' && content.length > 200000) return;
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      value = parsed?.live_play_info;
    } catch { return; }
  }
  if (!value || typeof value !== 'object') return;
  const room = Number(value.room_id || value.roomid || value.id);
  if (!Number.isSafeInteger(room) || room <= 0) return;
  return normalizeLive({ ...value, room_id: room, uname: author });
}
