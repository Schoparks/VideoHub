import '../../src/android/runtime-compatibility';
import { BilibiliAccount } from '../../electron/accounts/bilibili-account';
import { BilibiliProvider } from '../../electron/providers/bilibili';
import { PlaybackSessions } from '../../electron/playback/session';
import { Vault as DesktopVault } from '../../electron/accounts/vault';
import { Store as DesktopStore } from '../../electron/storage/store';
import { MediaGateway as DesktopGateway } from '../../electron/playback/gateway';
import { parseUrl } from '../../electron/providers/local';
import { httpMediaUrl, mediaFormat } from '../../electron/providers/url-media';
import { rewriteWebDash } from '../../electron/playback/web-dash';
import { schemas } from '../../electron/ipc';
import type { HubApi, MediaItem } from '../../src/shared/types';
import { native } from './native';
import { installFetch, nativeFetch } from './fetch';
import { Vault } from './vault';
import { Store } from './store';
import { MediaGateway } from './gateway';
import { LocalLibrary } from './library';
import { androidVideoSupport } from './video-support';

installFetch();
const vault = new Vault();
const store = new Store();
const gateway = new MediaGateway();
const account = new BilibiliAccount(vault as unknown as DesktopVault, nativeFetch);
const bili = new BilibiliProvider(account);
let resolution: AbortController | undefined;
const sessions = new PlaybackSessions(store as unknown as DesktopStore, bili, gateway as unknown as DesktopGateway, undefined, async item => {
  resolution?.abort();
  const controller = resolution = new AbortController();
  const address = httpMediaUrl(item.url || '');
  let format = mediaFormat(address);
  // Extensionless responses are bounded; full media bytes are read by the native gateway.
  if (!format) {
    const response = await nativeFetch(address, { method: 'HEAD', signal: controller.signal, credentials: 'omit' });
    format = mediaFormat(response.url, response.headers.get('content-type') || '');
  }
  if (!format) throw new Error('安卓电视暂支持媒体直链；此网页请使用桌面版检测');
  if (controller.signal.aborted) throw new Error('解析已取消');
  if (format === 'dash') {
    const response = await nativeFetch(address, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`媒体清单返回 HTTP ${response.status}`);
    const session = crypto.randomUUID();
    const resource = { session, referer: undefined };
    try {
      const text = rewriteWebDash(await response.text(), response.url,
        url => gateway.register({ ...resource, url }), url => gateway.registerTemplate(resource, url));
      return { item, url: gateway.register({ ...resource, text, mime: 'application/dash+xml' }), format,
        dispose: () => gateway.release(session) };
    } catch (error) { gateway.release(session); throw error; }
  }
  return { item, url: address, format };
}, androidVideoSupport);
const library = new LocalLibrary(store);
const initialized = Promise.all([vault.init(), store.init()]);
const official = (item: MediaItem) => item.source === 'bilibili'
  ? item.kind === 'live' ? `https://live.bilibili.com/${item.roomId}`
    : item.episodeId ? `https://www.bilibili.com/bangumi/play/ep${item.episodeId}`
      : item.seasonId ? `https://www.bilibili.com/bangumi/play/ss${item.seasonId}`
        : `https://www.bilibili.com/video/${item.bvid || `av${item.aid}`}` : item.url;

const api: Omit<HubApi, 'onSuspend' | 'onFullscreen'> = {
  bootstrap: async () => {
    await initialized;
    return { ...store.state, account: account.status(), platform: 'android', version: __YINGJI_ANDROID_VERSION__, notice: store.notice };
  },
  browse: request => bili.browse(request), folders: () => bili.folders(),
  detail: item => item.source === 'bilibili' ? bili.detail(item) : Promise.resolve({ item, parts: [], description: item.description || '' }),
  login: type => account.start(type), pollLogin: id => account.poll(id),
  cancelLogin: async id => { account.cancel(id); },
  logout: async () => { const result = await account.logout(); bili.reset(); return result; },
  addLocal: directory => library.add(directory), rescan: () => library.rescan(),
  openUrl: async url => parseUrl(url),
  resolve: (item, part, quality) => sessions.resolve(item, part, quality),
  cancelUrlResolution: async () => { resolution?.abort(); },
  release: id => sessions.release(id), progress: (id, position, duration, flush) => sessions.progress(id, position, duration, flush),
  danmaku: id => sessions.danmaku(id),
  watchLater: (item, add) => bili.watchLater(item, add), favorite: (item, folder, add) => bili.favorite(item, folder, add),
  queue: items => store.update(state => ({ ...state, queue: items })),
  preferences: value => store.update(state => ({ ...state, preferences: { ...value, tvMode: true } })),
  fullscreen: async () => {}, getFullscreen: async () => true,
  openOfficial: async item => {
    const url = official(item);
    if (!url) throw new Error('此来源没有官方入口');
    const error = native.official(url);
    if (error) throw new Error(error);
  },
};

window.backendCall = async (id, method, args) => {
  try {
    if (!Object.hasOwn(schemas, method)) throw new Error('不允许的应用操作');
    const schema = schemas[method as keyof typeof schemas];
    const checked = schema.parse(args.map(value => value === null ? undefined : value));
    await initialized;
    const action = api[method as keyof typeof api];
    const value = await (action as (...values: unknown[]) => Promise<unknown>)(...checked);
    native.reply(id, JSON.stringify({ value }));
  } catch (error) {
    native.reply(id, JSON.stringify({ error: error instanceof Error ? error.message : '操作失败，请重试' }));
  }
};
native.ready();
