import { defaultPreferences, type HubApi, type Bootstrap } from './shared/types';
// Browser preview deliberately has no account/file capabilities and no fabricated content.
const preview: Bootstrap = { account: { app: false, web: false, storage: 'memory' }, library: [], history: [], queue: [], preferences: { ...defaultPreferences }, platform: 'web', version: '0.1.0', preview: true };
const unavailable = async (): Promise<never> => {
  throw new Error('此操作需要在桌面应用中使用');
};
export const api: HubApi = window.hub || {
  getFullscreen: async () => !!document.fullscreenElement,
  onFullscreen: callback => {
    const changed = () => callback(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  },
  bootstrap: async () => preview, browse: unavailable, folders: unavailable, detail: unavailable, login: unavailable, pollLogin: unavailable, cancelLogin: async () => {}, logout: unavailable, addLocal: unavailable, rescan: unavailable, openUrl: unavailable, resolve: unavailable, release: async () => {}, progress: unavailable, danmaku: unavailable, watchLater: unavailable, favorite: unavailable, queue: async items => { preview.queue = items; }, preferences: async value => { preview.preferences = value; }, fullscreen: async value => { if (value) await document.documentElement.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); }, openOfficial: unavailable
};
export const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';
export const time = (seconds = 0) => { const s = Math.max(0, Math.floor(seconds)); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`; };
