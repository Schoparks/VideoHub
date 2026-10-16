import type { BrowseRequest, DynamicItem, Folder, MediaDetail, MediaItem, MediaPart, Page } from '../../src/shared/types';
import { BilibiliAccount } from '../accounts/bilibili-account';
import { normalizePgcHistory, normalizeSeason, normalizeSeasonDetail } from './bilibili-pgc';
import { recommendationParams } from '../protocol/signing';
import { BilibiliSigning } from '../protocol/bilibili-signing';
import { ProviderError } from '../protocol/http';
import { searchBilibili } from './bilibili-search';
import { playPgc } from './bilibili-pgc-playback';
import { normalizeLive } from './bilibili-live';
import { normalizeDynamicLive } from './bilibili-dynamic-live';
import { bilibiliList } from './bilibili-list-response';
const API = 'https://api.bilibili.com';
const image = (url?: string) => typeof url === 'string' ? url.replace(/^(?:http:)?\/\//, 'https://') : undefined;
const text = (value: any) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const duration = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+(?::\d+){1,2}$/.test(value)) return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return undefined;
};
export function normalizeVideo(v: any): MediaItem {
  const history = v.history || {};
  const aid = Number(v.aid || v.player_args?.aid || (v.goto === 'av' ? v.param : 0) || v.id || history.oid) || undefined;
  const bvid = v.bvid || history.bvid;
  return { id: `bili:${bvid || aid}`, source: 'bilibili', kind: 'video', bvid, aid, cid: v.cid || v.player_args?.cid || history.cid, title: text(v.title), cover: image(v.pic || v.cover), author: text(v.owner?.name || v.upper?.name || v.author_name || v.author || v.args?.up_name), duration: duration(v.duration ?? v.player_args?.duration ?? v.duration_text), badge: v.rcmd_reason?.content || v.cover_left_text_1, description: text(v.desc) };
}
/** Display adaptation only; recommendation admission/deduplication use raw App fields below. */
function normalizeAppRecommendation(card: any): MediaItem {
  const item = normalizeVideo({ ...card, aid: card.args?.aid, author: card.mask?.avatar?.text || '', duration: card.player_args?.duration ?? duration(card.cover_right_text), cid: card.player_args?.cid });
  item.id = `bili:${card.args?.aid || card.bvid}`;
  item.aid = Number(card.args?.aid) || undefined;
  item.author = text(card.mask?.avatar?.text);
  const reason = card.bottom_rcmd_reason?.trim();
  item.badge = text(card.desc?.split('·')?.[1]?.trim() || (reason === '已关注' || reason === '已關注' ? reason : ''));
  if (card.goto === 'bangumi' && card.uri) {
    const episode = /(?:\/ep|episode\/)(\d+)/.exec(card.uri), season = /(?:\/ss|season\/)(\d+)/.exec(card.uri);
    if (episode || season) { item.kind = 'season'; item.episodeId = episode ? Number(episode[1]) : undefined; item.seasonId = season ? Number(season[1]) : undefined; }
  }
  return item;
}
export function normalizeDynamic(v: any, depth = 0): DynamicItem {
  const author = v.modules?.module_author || {}, dynamic = v.modules?.module_dynamic || {}, major = dynamic.major || {};
  const archive = major.archive, opus = major.opus, article = major.article;
  const id = String(v.id_str || v.id || '');
  const summary = dynamic.desc?.text || opus?.summary?.text || article?.desc || '';
  const title = opus?.title || article?.title || major.common?.title || '';
  const images = (major.draw?.items || opus?.pics || article?.covers || []).map((p: any) => image(typeof p === 'string' ? p : p.src || p.url)).filter((p: any): p is string => !!p);
  const item: DynamicItem = { id, author: text(author.name || 'B 站用户'), avatar: image(author.face), publishedAt: Number(author.pub_ts) > 0 ? Number(author.pub_ts) * 1000 : undefined, text: text([title, summary].filter(Boolean).join('\n') || major.none?.tips || ''), images, url: `https://t.bilibili.com/${id}` };
  if (archive && (archive.bvid || archive.aid)) item.video = normalizeVideo({ ...archive, author: author.name });
  if (major.pgc?.epid) item.video = { ...normalizeSeason(major.pgc), id: `episode:${major.pgc.epid}`, episodeId: Number(major.pgc.epid), title: text(major.pgc.title) };
  if (!item.video) item.video = normalizeDynamicLive(major, item.author);
  if (v.orig && depth < 3) item.original = normalizeDynamic(v.orig, depth + 1);
  return item;
}
export function appendUnique(existing: MediaItem[], incoming: MediaItem[]) {
  const seen = new Set(existing.map(x => x.id));
  return [...existing, ...incoming.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; })];
}
export class BilibiliProvider {
  private feed: any[] = [];
  private feedIdx: string | number = 1;
  private feedEmptyLoads = 0;
  private feedLoaded = false;
  private feedVersion = 0;
  private feedGeneration = -1;
  private feedRequest?: Promise<Page>;
  private signing: BilibiliSigning;
  constructor(readonly account: BilibiliAccount) {
    this.signing = new BilibiliSigning(account.http);
  }
  reset() { this.feed = []; this.feedIdx = 1; this.feedEmptyLoads = 0; this.feedLoaded = false; this.feedVersion++; this.feedRequest = undefined; this.feedGeneration = -1; this.signing.reset(); }
  private async signed(path: string, params: Record<string, string | number>, retry = true): Promise<any> {
    return this.signing.get(path, params, retry);
  }
  private async recommend(request: BrowseRequest): Promise<Page> {
    const accessKey = await this.account.accessKey();
    const generation = this.account.vault.generation;
    if (this.feedGeneration !== generation) { this.reset(); this.feedGeneration = generation; }
    if (request.refresh) { this.feed = []; this.feedIdx = 1; this.feedEmptyLoads = 0; this.feedLoaded = false; this.feedVersion++; this.feedRequest = undefined; }
    const snapshot = (): Page => ({ items: this.feed.map(normalizeAppRecommendation), hasMore: this.feedEmptyLoads < 5, cursor: String(this.feedIdx) });
    if (!request.refresh && ((!request.cursor && this.feedLoaded) || this.feedEmptyLoads >= 5)) return snapshot();
    if (this.feedRequest) return this.feedRequest;
    const version = this.feedVersion;
    const current = () => generation === this.account.vault.generation && version === this.feedVersion;
    const job = (async () => {
      const deadline = Date.now() + 5000;
      let cards: any[] | undefined, failure: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { payload } = await this.account.http.raw('https://app.bilibili.com/x/v2/feed/index', recommendationParams(accessKey, this.feedIdx), false, true, 20000);
          if (!current()) throw new Error('推荐会话已更新，请重新加载');
          if (payload.code === 62011) throw new ProviderError('App 推荐授权已失效，请重新扫码连接 App 授权', 62011);
          if (payload.code !== 0) throw new ProviderError(String(payload.message || payload.msg || 'App 推荐请求失败'), payload.code);
          if (!Array.isArray(payload.data?.items) || !payload.data.items.length) throw new Error('App 推荐接口连续返回空数据');
          cards = payload.data.items; break;
        } catch (error) {
          if (!current() || (error instanceof ProviderError && error.code === 62011)) throw error;
          failure = error;
        }
        if (attempt === 2) break;
        const delay = Math.max(0, Math.min(250 * 2 ** attempt, deadline - Date.now()));
        if (!delay) break;
        await new Promise(resolve => setTimeout(resolve, delay));
        if (!current()) throw new Error('推荐会话已更新，请重新加载');
      }
      if (!cards) throw failure || new Error('App 推荐请求失败');
      const before = this.feed.length;
      for (const card of cards) {
        if (String(card.card_type || '').includes('banner') || card.card_type === 'cm_v1') continue;
        if (!(card.args?.aid && card.args.aid > 0) && !(typeof card.bvid === 'string' && card.bvid.trim())) continue;
        // Match BewlyCat's unfiltered App branch, including comparisons of absent IDs.
        if (this.feed.some(saved => saved.args?.aid === card.args?.aid || saved.bvid === card.bvid)) continue;
        this.feed.push(card);
      }
      this.feedIdx = this.feed.length ? this.feed.at(-1).idx : 1;
      this.feedEmptyLoads = this.feed.length > before ? 0 : this.feedEmptyLoads + 1;
      this.feedLoaded = true;
      return snapshot();
    })();
    this.feedRequest = job;
    try { return await job; } finally { if (this.feedRequest === job) this.feedRequest = undefined; }
  }
  async browse(request: BrowseRequest): Promise<Page> {
    const page = request.page || 1, h = this.account.http;
    switch (request.kind) {
      case 'recommend': return this.recommend(request);
      case 'dynamic': {
        this.account.web();
        const offset = request.refresh ? '' : request.cursor || '';
        const d = await h.get(`${API}/x/polymer/web-dynamic/v1/feed/all`, { type: request.dynamicType || 'all', offset, timezone_offset: -480, features: 'itemOpusStyle,listOnlyfans' });
        const allDynamics: DynamicItem[] = (d.items || []).map((v: any) => normalizeDynamic(v));
        const isVideo = (item?: MediaItem) => !!item && item.kind !== 'live';
        const dynamics = request.dynamicType === 'video' ? allDynamics.filter(v => isVideo(v.video) || isVideo(v.original?.video)) : allDynamics;
        const cursor = d.offset ? String(d.offset) : undefined;
        return { dynamics, items: dynamics.flatMap(v => v.video ? [v.video] : []), cursor, hasMore: !!d.has_more && !!cursor && cursor !== offset };
      }
      case 'history': {
        this.account.web();
        const cursor = request.cursor ? JSON.parse(request.cursor) : {};
        const d = await h.get(`${API}/x/web-interface/history/cursor`, { ps: 24, max: cursor.max || 0, view_at: cursor.view_at || 0, business: cursor.business || '' });
        const items = (d.list || []).filter((v: any) => ['archive', 'pgc', 'live'].includes(v.history?.business)).map((v: any) => v.history.business === 'live' ? normalizeLive({ ...v, roomid: v.history.oid }) : v.history.business === 'pgc' ? normalizePgcHistory(v) : normalizeVideo(v));
        return { items, cursor: JSON.stringify(d.cursor), hasMore: (d.list || []).length >= 24 };
      }
      case 'watchlater': {
        this.account.web(); const d = await h.get(`${API}/x/v2/history/toview`); return { items: (d.list || []).map(normalizeVideo), hasMore: false };
      }
      case 'favorites': {
        this.account.web(); const d = await h.get(`${API}/x/v3/fav/resource/list`, { media_id: request.id, pn: page, ps: 24, platform: 'web', order: 'mtime' });
        return { items: (d.medias || []).filter((v: any) => v.type === 2).map(normalizeVideo), hasMore: !!d.has_more };
      }
      case 'followingLive': {
        this.account.web(); const d = await h.get('https://api.live.bilibili.com/xlive/web-ucenter/user/following', { page, page_size: 24, ignoreRecord: 1, hit_ab: true });
        return { items: (d.rooms || d.list || []).map(normalizeLive), hasMore: !!d.has_more };
      }
      case 'regions': {
        const d = await h.get(`${API}/x/web-interface/ranking/v2`, { rid: request.id || 4, type: 'all' });
        const items = (d.list || []).map(normalizeVideo);
        return { items: items.slice((page - 1) * 24, page * 24), hasMore: page * 24 < items.length, notice: '分区排行榜 · 按 B 站榜单顺序展示' };
      }
      case 'cinema': {
        const d = await h.get(`${API}/pgc/season/index/result`, { season_type: request.id || 2, type: 1, page, pagesize: 24, order: 3, sort: 0 });
        return { items: bilibiliList(d, 'list', '影视', page, 'total').map(normalizeSeason), hasMore: !!d.has_next };
      }
      case 'followingCinema': {
        this.account.web(); const d = await h.get(`${API}/x/space/bangumi/follow/list`, { vmid: this.account.vault.value.webMid, type: request.id || 1, pn: page, ps: 24, follow_status: 0 });
        return { items: (d.list || []).map(normalizeSeason), hasMore: page * 24 < d.total };
      }
      case 'search': {
        return searchBilibili(request, params => this.signed('/x/web-interface/wbi/search/type', params), normalizeVideo);
      }
    }
  }
  async folders(): Promise<Folder[]> {
    this.account.web(); const d = await this.account.http.get(`${API}/x/v3/fav/folder/created/list-all`, { up_mid: this.account.vault.value.webMid });
    return (d.list || []).map((v: any) => ({ id: v.id, title: text(v.title), count: v.media_count }));
  }
  async detail(item: MediaItem): Promise<MediaDetail> {
    if (item.kind === 'live') {
      const d = await this.account.http.get('https://api.live.bilibili.com/room/v1/Room/get_info', { room_id: item.roomId });
      return { item: { ...item, roomId: d.room_id, title: text(d.title), cover: image(d.user_cover || d.keyframe), badge: d.live_status === 1 ? '直播中' : '未开播' }, parts: [], description: text(d.description) };
    }
    if (item.kind === 'season') {
      if (!item.seasonId && !item.episodeId) throw new Error('缺少影视分集信息，请重新打开 B 站播放页');
      const d = await this.account.http.get(`${API}/pgc/view/web/season`, item.seasonId ? { season_id: item.seasonId } : { ep_id: item.episodeId });
      return normalizeSeasonDetail(item, d);
    }
    const d = await this.account.http.get(`${API}/x/web-interface/view`, item.bvid ? { bvid: item.bvid } : { aid: item.aid });
    return { item: normalizeVideo(d), parts: (d.pages || []).map((p: any) => ({ id: `cid:${p.cid}`, cid: p.cid, aid: d.aid, bvid: d.bvid, title: p.part, duration: p.duration })), description: text(d.desc) };
  }
  playbackDetail(item: MediaItem): Promise<MediaDetail> {
    return item.kind === 'video' ? this.signing.withKeys(() => this.detail(item)) : this.detail(item);
  }
  async play(item: MediaItem, part?: MediaPart, quality = 127): Promise<any> {
    if (item.kind === 'live') {
      const d = await this.account.http.get('https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo', { room_id: item.roomId, protocol: '0,1', format: '0,1,2', codec: '0', qn: 10000, platform: 'web', ptype: 8 });
      if (d.live_status !== 1) throw new Error('这个直播间尚未开播');
      const streams = d.playurl_info?.playurl?.stream || [];
      const formats = streams.flatMap((s: any) => s.format || []);
      const format = formats.find((f: any) => ['ts', 'fmp4'].includes(f.format_name)) || formats[0];
      const codec = format?.codec?.find((c: any) => c.codec_name === 'avc') || format?.codec?.[0];
      const address = codec?.url_info?.[0];
      if (!address) throw new Error('直播间没有返回可用播放流');
      return { liveUrl: address.host + codec.base_url + address.extra, format: format.format_name === 'flv' ? 'flv' : 'hls' };
    }
    if (item.kind === 'season') {
      const data = await playPgc(this.account.http, item, part, quality);
      return this.playbackNotice(data);
    }
    const cid = part?.cid || item.cid;
    if (!cid) throw new Error('缺少分 P 信息，请重新打开详情');
    const params = { cid, bvid: part?.bvid || item.bvid || '', avid: part?.aid || item.aid || 0, qn: quality, fnval: 4048, fnver: 0, fourk: 1, high_quality: 1 };
    const d = await this.signed('/x/player/wbi/playurl', params);
    if (d.is_drm || d.drm_tech_type) throw new Error('此内容需要官方受保护播放器，请使用“在 B 站打开”');
    return this.playbackNotice(d);
  }
  private playbackNotice(d: any) {
    if (!d.dash?.video?.length && !d.durl?.length) throw new Error('当前账号没有可用播放流，请检查登录、会员或地区权限');
    if (d.is_preview || d.isPreview) d.playbackNotice = '当前为平台提供的试看内容，请检查会员或购买权限。';
    else if (!this.account.status().web) d.playbackNotice = '当前以游客身份播放，高清画质可能受限。请在账号中完成网页登录；App 推荐授权不等同于播放登录。';
    return d;
  }
  async watchLater(item: MediaItem, add: boolean) {
    if (item.kind !== 'video' || !item.aid) throw new Error('稍后再看仅支持普通 B 站视频');
    await this.account.http.get(`${API}/x/v2/history/toview/${add ? 'add' : 'del'}`, { aid: item.aid, csrf: this.account.csrf() }, true);
  }
  async favorite(item: MediaItem, folderId: number, add: boolean) {
    if (!item.aid || item.kind !== 'video') throw new Error('此内容不支持视频收藏');
    await this.account.http.get(`${API}/x/v3/fav/resource/deal`, { rid: item.aid, type: 2, add_media_ids: add ? folderId : '', del_media_ids: add ? '' : folderId, csrf: this.account.csrf() }, true);
  }
  async heartbeat(item: MediaItem, part: MediaPart | undefined, position: number) {
    await this.account.http.get(`${API}/x/click-interface/web/heartbeat`, { aid: part?.aid || item.aid, bvid: part?.bvid || item.bvid, cid: part?.cid || item.cid, ep_id: part?.episodeId || item.episodeId, sid: item.seasonId, type: item.kind === 'season' ? 4 : 3, played_time: Math.floor(position), csrf: this.account.csrf() }, true);
  }
}
