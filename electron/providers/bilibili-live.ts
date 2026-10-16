import type { MediaItem } from '../../src/shared/types';
import { normalizeImageUrl } from '../../src/shared/images';

const text = (value: unknown) => String(value ?? '').replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Following rooms and search use different artwork fields; avatars are not covers. */
export function normalizeLive(value: any): MediaItem {
  const roomId = Number(value.roomid || value.room_id);
  const cover = [value.room_cover, value.user_cover, value.cover_from_user, value.cover, value.keyframe]
    .map(address => typeof address === 'string' ? normalizeImageUrl(address.trim()) : undefined)
    .find(Boolean);
  const status = Number(value.live_status);
  return {
    id: `live:${roomId}`, source: 'bilibili', kind: 'live', roomId,
    title: text(value.title), cover, author: text(value.uname || value.name),
    badge: status === 1 ? '直播中' : status === 2 ? '轮播中' : '未开播',
  };
}
