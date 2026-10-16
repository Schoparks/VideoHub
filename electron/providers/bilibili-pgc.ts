import type { MediaDetail, MediaItem, MediaPart } from '../../src/shared/types';
import { bilibiliIds } from '../../src/shared/bilibiliReference';

const text = (value: unknown) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const image = (value: unknown) => typeof value === 'string' ? value.replace(/^(?:http:)?\/\//, 'https://') : undefined;

export function normalizeSeason(value: any): MediaItem {
  const ids = bilibiliIds({ seasonId: value.season_id, episodeId: value.new_ep?.id });
  return {
    ...ids,
    id: `season:${ids.seasonId}`,
    source: 'bilibili',
    kind: 'season',
    title: text(value.title),
    cover: image(value.cover),
    author: text(value.new_ep?.index_show || value.index_show || '番剧 · 影视'),
    badge: value.badge,
    description: text(value.evaluate),
  };
}

export function normalizePgcHistory(value: any): MediaItem {
  const ids = bilibiliIds({
    episodeId: value.history?.epid,
    seasonId: value.season_id,
    aid: value.aid,
    cid: value.history?.cid,
    bvid: value.history?.bvid,
  });
  const duration = Number(value.duration);
  return {
    ...normalizeSeason(value),
    ...ids,
    id: ids.episodeId ? `episode:${ids.episodeId}` : `season:${ids.seasonId}`,
    author: text(value.long_title || value.show_title || '番剧 · 影视'),
    duration: Number.isFinite(duration) && duration >= 0 ? duration : undefined,
  };
}

function normalizeEpisode(value: any): MediaPart {
  const ids = bilibiliIds({ episodeId: value.id, aid: value.aid, cid: value.cid, bvid: value.bvid });
  const duration = Number(value.duration);
  return {
    ...ids,
    id: `ep:${ids.episodeId}`,
    title: text(`${value.title || ''} ${value.long_title || ''}`.trim()),
    duration: Number.isFinite(duration) && duration >= 0 ? duration / 1000 : undefined,
  };
}

export function normalizeSeasonDetail(item: MediaItem, value: any): MediaDetail {
  return {
    item: {
      ...item,
      ...bilibiliIds({ ...item, seasonId: value.season_id }),
      title: text(value.title),
      cover: image(value.cover),
    },
    parts: (value.episodes || []).map(normalizeEpisode),
    description: text(value.evaluate),
  };
}
