import { z } from 'zod';
import { bilibiliQualityLimits } from './bilibili-quality';

const handle = z.string().uuid();
export const companionPreferences = z.object({
  tvMode: z.boolean(), theme: z.enum(['light', 'dark']),
  cardColumns: z.union([z.literal(0), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  playbackRate: z.number().min(.5).max(2), autoNext: z.boolean(), syncHistory: z.boolean(),
  danmaku: z.boolean(), danmakuOpacity: z.number().min(.2).max(1),
  danmakuFontSize: z.number().int().min(18).max(40),
  danmakuArea: z.union([z.literal(.25), z.literal(.5), z.literal(1)]),
  bilibiliMaxQuality: z.union(bilibiliQualityLimits.map(value => z.literal(value.id))),
  bilibiliQualityMode: z.enum(['highest', 'remember']),
});
export const playerCommand = z.discriminatedUnion('operation', [
  z.object({ operation: z.enum(['toggle', 'previous', 'next', 'stop', 'retry']) }),
  z.object({ operation: z.literal('seek'), value: z.number().finite().nonnegative() }),
  z.object({ operation: z.literal('rate'), value: z.union([z.literal(.5), z.literal(.75), z.literal(1), z.literal(1.25), z.literal(1.5), z.literal(2)]) }),
  z.object({ operation: z.literal('quality'), value: z.number().int().min(1).max(127) }),
  z.object({ operation: z.literal('episode'), value: z.string().max(100) }),
]);
export const catalogKinds = ['recommend', 'search', 'local', 'history', 'localHistory', 'queue', 'watchlater', 'followingLive', 'favorites', 'dynamic', 'regions', 'cinema', 'followingCinema'] as const;
export const companionCommand = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot') }),
  z.object({ kind: z.literal('tv-login'), operation: z.enum(['app', 'web', 'close']) }),
  z.object({ kind: z.literal('folders') }),
  z.object({ kind: z.literal('queue-edit'), operation: z.enum(['add', 'remove', 'up', 'down']), handle }),
  z.object({ kind: z.literal('collection-edit'), handle, add: z.boolean(),
    collection: z.enum(['favorites', 'watchlater']), folder: handle.optional() }),
  z.object({ kind: z.literal('catalog'), collection: z.enum(catalogKinds),
    folder: handle.optional(),
    category: z.number().int().min(1).max(1000).optional(),
    dynamicType: z.enum(['all', 'video']).optional(),
    keyword: z.string().trim().min(1).max(200).optional(),
    searchType: z.enum(['all', 'video', 'media_bangumi', 'media_ft', 'live_room']).optional(),
    page: z.number().int().min(1).max(10000).optional(), cursor: z.string().max(1000).optional(),
    refresh: z.boolean().optional() }),
  z.object({ kind: z.literal('play'), handle }),
  z.object({ kind: z.literal('cover'), handle }),
  z.object({ kind: z.literal('related'), session: handle }),
  z.object({ kind: z.literal('settings'), patch: companionPreferences.partial().strict() }),
  z.object({ kind: z.literal('player'), session: handle, command: playerCommand }),
]);
export const companionCard = z.object({
  handle, title: z.string().max(2000), author: z.string().max(500).optional(),
  duration: z.number().finite().nonnegative().optional(),
  source: z.enum(['bilibili', 'local', 'url']), kind: z.enum(['video', 'live', 'season']),
  artwork: z.boolean(),
});
export const companionPlayer = z.object({
  session: handle, title: z.string().max(2000), live: z.boolean(),
  paused: z.boolean(), ended: z.boolean(), busy: z.boolean(), loading: z.boolean(),
  error: z.string().max(2000), position: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(), rate: z.number(), quality: z.number().optional(),
  qualities: z.array(z.object({ id: z.number(), label: z.string().max(100) })).max(32),
  parts: z.array(z.object({ id: z.string().max(100), title: z.string().max(1000) })).max(2000),
  part: z.string().max(100).optional(), next: z.boolean(), related: z.boolean(),
});
const dynamicBlock = z.object({
  author: z.string().max(500), text: z.string().max(100000),
  images: z.array(handle).max(100), video: companionCard.optional(),
});
const companionDynamic = z.object({ handle, blocks: z.array(dynamicBlock).max(16) });
export const companionReply = z.object({
  error: z.enum(['busy', 'blocked', 'failed', 'unavailable', 'canceled', 'app-auth', 'web-auth']).optional(),
  state: z.object({ preferences: companionPreferences, player: companionPlayer.optional(), current: companionCard.optional(),
    account: z.object({ app: z.boolean(), web: z.boolean(), screen: z.boolean() }).optional(),
    opening: z.boolean(), catalogVersion: z.number().int().nonnegative() }).optional(),
  folders: z.array(z.object({ handle, title: z.string().max(500), count: z.number().nonnegative() })).max(1000).optional(),
  catalog: z.object({ items: z.array(companionCard).max(2000), dynamics: z.array(companionDynamic).max(2000).optional(),
    hasMore: z.boolean(), cursor: z.string().max(1000).optional() }).optional(),
  image: z.string().max(350000).regex(/^data:image\/(?:jpeg|png|webp|avif|gif);base64,[A-Za-z0-9+/=]+$/).optional(),
});
export type CompanionCommand = z.infer<typeof companionCommand>;
export type CompanionCard = z.infer<typeof companionCard>;
export type CompanionDynamic = z.infer<typeof companionDynamic>;
export type CompanionPlayer = z.infer<typeof companionPlayer>;
export type CompanionState = NonNullable<z.infer<typeof companionReply>['state']>;
export type CompanionSettings = z.infer<typeof companionPreferences>;
export type PlayerCommand = z.infer<typeof playerCommand>;
