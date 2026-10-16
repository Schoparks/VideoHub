import { z } from 'zod';
export const itemSchema = z.object({
  id: z.string().max(500), source: z.enum(['bilibili','local','url']), kind: z.enum(['video','live','season']), title: z.string().max(2000),
  cover: z.string().max(4000).optional(), author: z.string().max(500).optional(), duration: z.number().nonnegative().optional(), description: z.string().max(20000).optional(), badge: z.string().max(500).optional(),
  bvid: z.string().regex(/^BV[\da-zA-Z]{10}$/).optional(), aid: z.number().int().positive().optional(), cid: z.number().int().positive().optional(), seasonId: z.number().int().positive().optional(), episodeId: z.number().int().positive().optional(), roomId: z.number().int().positive().optional(), path: z.string().max(4000).optional(), url: z.string().max(10000).optional(), addedAt: z.number().optional()
});
export const partSchema = z.object({ id: z.string().max(100), title: z.string().max(1000), aid: z.number().int().positive().optional(), cid: z.number().int().positive().optional(), bvid: z.string().regex(/^BV[\da-zA-Z]{10}$/).optional(), episodeId: z.number().int().positive().optional(), duration: z.number().nonnegative().optional() });
export const schemas = {
  bootstrap: z.tuple([]),
  cancelUrlResolution: z.tuple([]),
  browse: z.tuple([z.object({
    kind: z.enum(['recommend','dynamic','history','favorites','watchlater','followingLive','regions','cinema','followingCinema','search']),
    dynamicType: z.enum(['all','video']).optional(),
    searchType: z.enum(['all','video','media_bangumi','media_ft','live_room']).optional(),
    page: z.number().int().min(1).max(10000).optional(),
    cursor: z.string().max(1000).optional(),
    id: z.number().int().nonnegative().optional(),
    keyword: z.string().max(200).optional(),
    refresh: z.boolean().optional(),
  })]),
  folders: z.tuple([]), detail: z.tuple([itemSchema]), login: z.tuple([z.enum(['app','web'])]), pollLogin: z.tuple([z.string().uuid()]), cancelLogin: z.tuple([z.string().uuid()]), logout: z.tuple([]),
  addLocal: z.tuple([z.boolean()]), rescan: z.tuple([]), openUrl: z.tuple([z.string().max(10000)]),
  resolve: z.tuple([itemSchema, partSchema.optional(), z.number().int().min(1).max(127).optional()]), release: z.tuple([z.string().uuid()]),
  progress: z.tuple([z.string().uuid(), z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.boolean().optional()]),
  danmaku: z.tuple([z.string().uuid()]),
  watchLater: z.tuple([itemSchema, z.boolean()]), favorite: z.tuple([itemSchema,z.number().int().positive(),z.boolean()]), queue: z.tuple([z.array(itemSchema).max(500)]),
  preferences: z.tuple([z.object({
    tvMode: z.boolean(), volume: z.number().min(0).max(1),
    cardColumns: z.union([z.literal(0), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).default(0),
    playbackRate: z.number().min(.5).max(2).default(1),
    syncHistory: z.boolean(), autoNext: z.boolean(),
    danmaku: z.boolean().default(false), danmakuOpacity: z.number().min(.2).max(1).default(.8),
    danmakuFontSize: z.number().int().min(18).max(40).default(25),
    danmakuArea: z.union([z.literal(.25), z.literal(.5), z.literal(1)]).default(.5),
    theme: z.enum(['light','dark']), deadzone: z.number().min(.1).max(.8),
    gamepadMap: z.record(z.string().max(30), z.number().int().min(0).max(31)),
  })]),
  fullscreen: z.tuple([z.boolean()]), getFullscreen: z.tuple([]), openOfficial: z.tuple([itemSchema])
};
