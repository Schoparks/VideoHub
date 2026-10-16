import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell, powerMonitor } from 'electron';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { Store } from './storage/store';
import { LocalLibrary } from './storage/local-library';
import { Vault } from './accounts/vault';
import { BilibiliAccount } from './accounts/bilibili-account';
import { BilibiliProvider } from './providers/bilibili';
import { parseUrl } from './providers/local';
import { resolveWebMedia, cancelWebMediaResolution } from './providers/web-media-probe';
import { MediaGateway } from './playback/gateway';
import { PlaybackSessions } from './playback/session';
import { schemas } from './ipc';
import { createFullscreenControl } from './window-fullscreen';
import type { HubApi } from '../src/shared/types';
import { fetchCover } from './images';
protocol.registerSchemesAsPrivileged([{ scheme: 'yingji', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (process.env.YINGJI_TEST_DATA) app.setPath('userData', resolve(process.env.YINGJI_TEST_DATA));
const hiddenTest = !!process.env.YINGJI_TEST_DATA && process.env.YINGJI_TEST_HIDDEN === '1';
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let window: BrowserWindow | null = null, playback: PlaybackSessions, gateway: MediaGateway;
let quitting = false;
async function main() {
  const fullscreen = createFullscreenControl(() => window, hiddenTest);
  const directory = app.getPath('userData'); await mkdir(directory, { recursive: true });
  const store = new Store(directory); await store.init();
  const local = new LocalLibrary(store);
  const vault = new Vault(directory, {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value)
  });
  await vault.init();
  const account = new BilibiliAccount(vault), bili = new BilibiliProvider(account);
  gateway = new MediaGateway(); await gateway.start(); playback = new PlaybackSessions(store, bili, gateway, undefined, resolveWebMedia);
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev && new URL(dev).origin !== 'http://127.0.0.1:5173') throw new Error('无效的开发服务器地址');
  const rendererUrl = dev || 'yingji://app/index.html';
  const origin = new URL(rendererUrl).origin;
  const trusted = (url: string) => dev ? new URL(url).origin === origin : url.startsWith('yingji://app/');
  const dist = resolve(__dirname, '../dist');
  protocol.handle('yingji', async request => {
    const target = new URL(request.url);
    if (target.hostname !== 'app') return new Response('', { status: 403 });
    if (target.pathname === '/image') return fetchCover(target.searchParams.get('url') || '');
    const path = resolve(dist, '.' + decodeURIComponent(target.pathname));
    if (!path.startsWith(dist + sep)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(path).href);
  });
  session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!trusted(details.url)) { callback({}); return; }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [`default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' yingji: data: https:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:5173; media-src 'self' blob: http://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'`] } });
  });
  const api: HubApi = {
    bootstrap: async () => ({ account: account.status(), library: store.state.library, history: store.state.history, queue: store.state.queue, preferences: store.state.preferences, platform: process.platform, version: app.getVersion(), notice: store.notice }),
    browse: request => bili.browse(request), folders: () => bili.folders(),
    detail: async item => item.source === 'bilibili' ? bili.detail(item) : { item, parts: [], description: item.source === 'local' ? item.path || '' : item.url || '' },
    login: type => account.start(type), pollLogin: id => account.poll(id), cancelLogin: async id => { account.cancel(id); },
    logout: async () => { const status = await account.logout(); bili.reset(); return status; },
    addLocal: directory => local.add(() => dialog.showOpenDialog(window!, {
      title: directory ? '添加本地视频目录' : '打开媒体文件',
      properties: directory ? ['openDirectory'] : ['openFile','multiSelections'],
      ...(directory ? {} : { filters: [{ name: '媒体文件', extensions: ['mp4','mkv','webm','mov','m4v','avi','ts','flv','mp3','flac'] }] }),
    })),
    rescan: () => local.rescan(),
    openUrl: async url => {
      let input = url;
      if (/^https?:\/\/b23\.tv\//i.test(input)) {
        const response = await fetch(input, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) });
        const location = response.headers.get('location');
        if (!location) throw new Error('B 站短链接无法解析');
        const target = new URL(location, input);
        if (!['bilibili.com','www.bilibili.com','m.bilibili.com','live.bilibili.com'].includes(target.hostname)) throw new Error('短链接没有指向 B 站播放页');
        input = target.href;
      }
      return parseUrl(input);
    },
    resolve: (item,part,quality) => playback.resolve(item,part,quality), release: id => playback.release(id), progress: (...args) => playback.progress(...args),
    cancelUrlResolution: cancelWebMediaResolution,
    danmaku: id => playback.danmaku(id),
    watchLater: (item,add) => bili.watchLater(item,add), favorite: (item,id,add) => bili.favorite(item,id,add),
    queue: items => store.update(state => ({ ...state, queue: items })),
    preferences: value => store.update(state => ({ ...state, preferences: value })),
    fullscreen,
    getFullscreen: async () => window?.isFullScreen() ?? false,
    openOfficial: async item => {
      const url = item.kind === 'live' ? `https://live.bilibili.com/${Number(item.roomId)}` : item.kind === 'season' ? `https://www.bilibili.com/bangumi/play/${item.episodeId ? `ep${Number(item.episodeId)}` : `ss${Number(item.seasonId)}`}` : `https://www.bilibili.com/video/${item.bvid || `av${Number(item.aid)}`}`;
      if (item.source !== 'bilibili') throw new Error('没有对应的 B 站页面'); await shell.openExternal(url);
    }
  };
  for (const name of Object.keys(schemas) as (keyof typeof schemas)[]) {
    ipcMain.handle(`hub:${name}`, async (event,args) => {
      if (event.sender !== window?.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame || !trusted(event.senderFrame.url)) return { ok: false, error: '请求来源不被允许' };
      try { const input = schemas[name].parse(args); return { ok: true, data: await (api[name] as (...args: any[]) => Promise<unknown>)(...input) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? (error.name === 'ZodError' ? '请求参数不正确' : error.message) : '操作失败' }; }
    });
  }
  const createWindow = () => {
    window = new BrowserWindow({ width: 1440, height: 950, minWidth: 960, minHeight: 640, title: '映集 · Video Hub', backgroundColor: '#f7f8fa',
      icon: join(app.getAppPath(), app.isPackaged ? 'dist' : 'public', 'app-icon-512.png'),
      show: !hiddenTest, skipTaskbar: hiddenTest, fullscreen: !hiddenTest && store.state.preferences.tvMode,
      webPreferences: { preload: join(__dirname,'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, webSecurity: true } });
    if (hiddenTest) window.webContents.setAudioMuted(true);
    const nativeWindow = window;
    const stateChanged = () => {
      if (nativeWindow.isDestroyed() || nativeWindow.webContents.isDestroyed()) return;
      nativeWindow.webContents.send('window:fullscreen', nativeWindow.isFullScreen());
    };
    window.on('enter-full-screen', stateChanged);
    window.on('leave-full-screen', stateChanged);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
    window.on('closed', () => { window = null; });
    void window.loadURL(rendererUrl);
  };
  createWindow();
  powerMonitor.on('suspend', () => { window?.webContents.send('system:suspend'); });
  app.on('activate', () => { if (!window) createWindow(); });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (!hiddenTest) { window?.show(); window?.focus(); } });
  void app.whenReady().then(main).catch(error => {
    if (hiddenTest) console.error('映集隔离测试启动失败');
    else dialog.showErrorBox('映集启动失败', String(error.message));
    app.quit();
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (quitting || !playback) return;
  event.preventDefault();
  quitting = true;
  void cancelWebMediaResolution().then(() => playback.close()).catch(() => {})
    .then(() => gateway.stop()).finally(() => app.quit());
});
