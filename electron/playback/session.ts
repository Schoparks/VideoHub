import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import type { DanmakuComment, MediaItem, MediaPart, PlaybackSource } from '../../src/shared/types';
import { BilibiliProvider } from '../providers/bilibili';
import { resolveDirectUrl, type UrlMediaResolver } from '../providers/url-media';
import { Store, historyKey } from '../storage/store';
import { MediaGateway } from './gateway';
import { buildDashManifest, playbackQualities } from './dash';
import { HistorySync } from './history-sync';
import { resumePosition } from '../../src/shared/playback-progress';
import { fetchDanmaku } from '../providers/bilibili-danmaku';
import type { VideoSupport } from './dash-video';

interface Session {
  item: MediaItem;
  part?: MediaPart;
  lastSync: number;
  lastSave: number;
  progress?: { position: number; duration: number };
  syncRevision: number;
  synced: boolean;
  warning?: string;
  danmaku?: Promise<DanmakuComment[]>;
  danmakuAbort?: AbortController;
  dispose?: () => void | Promise<void>;
}

export class PlaybackSessions {
  private sessions = new Map<string, Session>();
  private historySync = new HistorySync();
  constructor(private store: Store, private bili: BilibiliProvider, private gateway: MediaGateway,
    private loadDanmaku: typeof fetchDanmaku = fetchDanmaku,
    private resolveUrl: UrlMediaResolver = resolveDirectUrl,
    private videoSupport?: VideoSupport) {}
  async resolve(input: MediaItem, part?: MediaPart, requestedQuality = 127): Promise<PlaybackSource> {
    let item = input, url: string, format: PlaybackSource['format'] = 'file', qualities, quality, notice;
    let parts: MediaPart[] = [];
    let videoCodec: PlaybackSource['videoCodec'];
    let videoCapabilities: PlaybackSource['videoCapabilities'];
    let dispose: (() => void | Promise<void>) | undefined;
    const sessionId = randomUUID();
    const register = (url: string, backups?: string[]) => this.gateway.register({
      session: sessionId, url, backups, bili: input.source === 'bilibili',
    });
    try {
      if (input.source === 'local') {
        item = this.store.state.library.find(x => x.id === input.id)!;
        if (!item?.path) throw new Error('该文件不在已授权的片库中');
        await access(item.path).catch(() => { throw new Error('文件已移动或磁盘未连接，历史记录仍然保留'); });
        url = this.gateway.register({ session: sessionId, path: item.path });
      } else if (input.source === 'url') {
        const media = await this.resolveUrl(input);
        item = media.item;
        format = media.format;
        dispose = media.dispose;
        url = this.gateway.register({ session: sessionId, url: media.url, referer: media.referer, request: media.request });
      } else {
        if (input.kind !== 'live') {
          const detail = await this.bili.playbackDetail(input); item = detail.item; parts = detail.parts;
          const requestedPart = part;
          part = requestedPart
            ? parts.find(p => p.id === requestedPart.id || (requestedPart.cid !== undefined && p.cid === requestedPart.cid) || (requestedPart.episodeId !== undefined && p.episodeId === requestedPart.episodeId))
            : parts.find(p => (input.episodeId !== undefined && p.episodeId === input.episodeId) || (input.cid !== undefined && p.cid === input.cid)) || parts[0];
          if (!part) throw new Error('这集已不可用，请重新打开视频选择其他分集');
        }
        const data = await this.bili.play(item, part, requestedQuality);
        notice = data.playbackNotice;
        if (data.liveUrl) { url = register(data.liveUrl); format = data.format; }
        else if (data.dash) {
          const mpd = buildDashManifest(data.dash, register, requestedQuality, this.videoSupport);
          quality = mpd.quality;
          videoCodec = mpd.codec;
          videoCapabilities = mpd.capabilities;
          url = this.gateway.register({ session: sessionId, text: mpd.manifest, mime: 'application/dash+xml' }); format = 'dash';
          qualities = playbackQualities(data, this.videoSupport);
        } else {
          if (data.durl.length !== 1) throw new Error('此内容返回旧式多段流，暂请使用官方播放入口');
          url = register(data.durl[0].url); format = /\.flv(?:$|\?)/i.test(data.durl[0].url) ? 'flv' : 'file';
          quality = data.quality; qualities = playbackQualities(data);
        }
      }
      const previous = this.store.state.history.find(x => historyKey(x.item, x.part) === historyKey(item, part));
      const startAt = resumePosition(previous);
      this.sessions.set(sessionId, { item, part, lastSync: 0, lastSave: 0, syncRevision: 0, synced: false, dispose });
      return { sessionId, item, part, parts, url, format, startAt, qualities, quality,
        videoCodec, videoCapabilities, notice, live: item.kind === 'live' };
    } catch (error) {
      this.gateway.release(sessionId);
      await dispose?.();
      throw error;
    }
  }
  async progress(sessionId: string, position: number, duration: number, flush = false) {
    const session = this.sessions.get(sessionId);
    if (!session) return { synced: false };
    session.progress = { position, duration };
    if (session.item.kind === 'live') return { synced: false };
    if (flush || Date.now() - session.lastSave >= 5000) {
      await this.store.record({ item: session.item, part: session.part, position, duration, updatedAt: Date.now() });
      session.lastSave = Date.now();
    }
    if (this.store.state.preferences.syncHistory && session.item.source === 'bilibili' && this.bili.account.status().web && (flush || Date.now() - session.lastSync >= 15000)) {
      session.lastSync = Date.now();
      const revision = ++session.syncRevision;
      const accountId = this.bili.account.status().webMid;
      session.synced = false;
      this.historySync.enqueue(historyKey(session.item, session.part), {
        run: async () => {
          const account = this.bili.account.status();
          if (!this.store.state.preferences.syncHistory || !account.web || account.webMid !== accountId) return false;
          await this.bili.heartbeat(session.item, session.part, position);
          return true;
        },
        complete: result => {
          if (revision !== session.syncRevision) return;
          session.synced = result === 'synced';
          session.warning = result === 'failed' ? '进度已保存到本机，B 站历史同步暂时失败' : undefined;
        },
      });
    }
    return { synced: session.synced, warning: session.warning };
  }
  async release(id: string) {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    session?.danmakuAbort?.abort();
    try {
      if (session?.progress && session.item.kind !== 'live') {
        await this.store.record({ item: session.item, part: session.part, ...session.progress, updatedAt: Date.now() });
      }
    } finally {
      this.gateway.release(id);
      await session?.dispose?.();
    }
  }
  async danmaku(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('播放会话已结束');
    if (session.item.source !== 'bilibili' || session.item.kind === 'live') return [];
    const cid = session.part?.cid || session.item.cid;
    if (!cid) return [];
    if (!session.danmaku) {
      session.danmakuAbort = new AbortController();
      session.danmaku = this.loadDanmaku(cid, session.danmakuAbort.signal).catch(error => {
        session.danmaku = undefined;
        throw error;
      });
    }
    return session.danmaku;
  }
  async close() {
    this.historySync.stop();
    const results = await Promise.allSettled([...this.sessions.keys()].map(id => this.release(id)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}
