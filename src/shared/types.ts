import type { VideoCapability, VideoCodec } from './video-capability';

export type Source = 'bilibili' | 'local' | 'url';
export interface MediaItem {
  id: string; source: Source; kind: 'video' | 'live' | 'season'; title: string;
  cover?: string; author?: string; duration?: number; description?: string; badge?: string;
  bvid?: string; aid?: number; cid?: number; seasonId?: number; episodeId?: number; roomId?: number;
  path?: string; url?: string; addedAt?: number;
}
export interface MediaPart { id: string; title: string; cid?: number; aid?: number; bvid?: string; episodeId?: number; duration?: number }
export interface MediaDetail { item: MediaItem; parts: MediaPart[]; description: string }
export interface DynamicItem { id: string; author: string; avatar?: string; publishedAt?: number; text: string; images: string[]; video?: MediaItem; original?: DynamicItem; url: string }
export interface Page { items: MediaItem[]; dynamics?: DynamicItem[]; hasMore: boolean; cursor?: string; notice?: string }
export type BrowseKind = 'recommend' | 'dynamic' | 'history' | 'favorites' | 'watchlater' | 'followingLive' | 'regions' | 'cinema' | 'followingCinema' | 'search';
export type SearchType = 'all' | 'video' | 'media_bangumi' | 'media_ft' | 'live_room';
export interface BrowseRequest { kind: BrowseKind; dynamicType?: 'all' | 'video'; searchType?: SearchType; page?: number; cursor?: string; id?: number; keyword?: string; refresh?: boolean }
export interface Folder { id: number; title: string; count: number }
export interface AccountStatus { app: boolean; web: boolean; appMid?: string; webMid?: string; name?: string; avatar?: string; storage: 'encrypted' | 'memory'; warning?: string }
export interface QRLogin { id: string; image: string; expiresAt: number; type: 'app' | 'web' }
export interface LoginPoll { state: 'waiting' | 'scanned' | 'expired' | 'success'; account?: AccountStatus }
export interface PlaybackSource {
  sessionId: string;
  item: MediaItem;
  part?: MediaPart;
  parts?: MediaPart[];
  url: string;
  format: 'file' | 'hls' | 'dash' | 'flv';
  startAt: number;
  qualities?: { id: number; label: string }[];
  quality?: number;
  videoCodec?: VideoCodec;
  videoCapabilities?: VideoCapability[];
  notice?: string;
  live: boolean;
}
export interface HistoryEntry { item: MediaItem; part?: MediaPart; position: number; duration: number; updatedAt: number }
export interface LocalImportResult { library: MediaItem[]; canceled: boolean; found: number; added: number }
export interface DanmakuComment { id: string; time: number; mode: 1 | 4 | 5 | 6; text: string; color: string }
export interface Preferences {
  tvMode: boolean; cardColumns: number; playbackRate: number; syncHistory: boolean; autoNext: boolean;
  /** Legacy storage field; player output gain stays at 1 and volume belongs to the TV/system. */
  volume: number;
  danmaku: boolean; danmakuOpacity: number; danmakuFontSize: number; danmakuArea: number;
  theme: 'light' | 'dark'; deadzone: number; gamepadMap: Record<string, number>;
}
export const defaultPreferences: Preferences = {
  tvMode: false, volume: 1, cardColumns: 0, playbackRate: 1, syncHistory: true, autoNext: true,
  danmaku: false, danmakuOpacity: .8, danmakuFontSize: 25, danmakuArea: .5,
  theme: 'light', deadzone: 0.28,
  gamepadMap: { confirm: 0, back: 1, details: 2, search: 3, previous: 4, next: 5, rewind: 6, forward: 7, pause: 9 },
};
export interface Bootstrap { account: AccountStatus; library: MediaItem[]; history: HistoryEntry[]; queue: MediaItem[]; preferences: Preferences; version: string; platform: string; preview?: boolean; notice?: string }
export interface HubApi {
  bootstrap(): Promise<Bootstrap>;
  browse(request: BrowseRequest): Promise<Page>;
  folders(): Promise<Folder[]>;
  detail(item: MediaItem): Promise<MediaDetail>;
  login(type: 'app' | 'web'): Promise<QRLogin>;
  pollLogin(id: string): Promise<LoginPoll>;
  cancelLogin(id: string): Promise<void>;
  logout(): Promise<AccountStatus>;
  addLocal(directory: boolean): Promise<LocalImportResult>;
  rescan(): Promise<MediaItem[]>;
  openUrl(url: string): Promise<MediaItem>;
  resolve(item: MediaItem, part?: MediaPart, quality?: number): Promise<PlaybackSource>;
  cancelUrlResolution?(): Promise<void>;
  release(sessionId: string): Promise<void>;
  progress(sessionId: string, position: number, duration: number, flush?: boolean): Promise<{ synced: boolean; warning?: string }>;
  danmaku(sessionId: string): Promise<DanmakuComment[]>;
  watchLater(item: MediaItem, add: boolean): Promise<void>;
  favorite(item: MediaItem, folderId: number, add: boolean): Promise<void>;
  queue(items: MediaItem[]): Promise<void>;
  preferences(value: Preferences): Promise<void>;
  fullscreen(value: boolean): Promise<void>;
  getFullscreen?(): Promise<boolean>;
  onFullscreen?(callback: (value: boolean) => void): () => void;
  openOfficial(item: MediaItem): Promise<void>;
  onSuspend?(callback: () => void): () => void;
}
declare global { interface Window { hub?: HubApi; hubPlatform?: 'android'; hubRemoteExit?: () => void } }
