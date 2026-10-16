import type { MediaItem } from './types';

type BilibiliIds = Pick<MediaItem, 'aid' | 'bvid' | 'cid' | 'seasonId' | 'episodeId' | 'roomId'>;
type RawBilibiliIds = { [Key in keyof BilibiliIds]?: unknown };

function positiveId(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Platform responses use zero/empty placeholders where our IPC contract uses absent IDs. */
export function bilibiliIds(value: RawBilibiliIds): BilibiliIds {
  return {
    aid: positiveId(value.aid),
    bvid: typeof value.bvid === 'string' && /^BV[\da-zA-Z]{10}$/.test(value.bvid) ? value.bvid : undefined,
    cid: positiveId(value.cid),
    seasonId: positiveId(value.seasonId),
    episodeId: positiveId(value.episodeId),
    roomId: positiveId(value.roomId),
  };
}
