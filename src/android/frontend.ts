import type { HubApi } from '../shared/types';

interface NativeHub { call(id: string, method: string, args: string): void; exit(): void }
declare global { interface Window { HubBridge?: NativeHub; hubReply?: (id: string, json: string) => void } }

if (window.HubBridge) {
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', `width=${Math.max(1280, Math.round(screen.width * devicePixelRatio))}`);
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let sequence = 0;
  const invoke = (method: string, args: unknown[]) => new Promise((resolve, reject) => {
    const id = String(++sequence);
    pending.set(id, { resolve, reject });
    window.HubBridge!.call(id, method, JSON.stringify(args));
  });
  window.hubReply = (id, json) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    const reply = JSON.parse(json);
    if (reply.error) request.reject(new Error(reply.error));
    else request.resolve(reply.value);
  };
  const names = [
    'bootstrap', 'browse', 'folders', 'detail', 'login', 'pollLogin', 'cancelLogin', 'logout',
    'addLocal', 'rescan', 'openUrl', 'resolve', 'cancelUrlResolution', 'release', 'progress',
    'danmaku', 'watchLater', 'favorite', 'queue', 'preferences', 'fullscreen', 'getFullscreen', 'openOfficial',
    'controllerStatus', 'controllerEnable', 'controllerReply',
  ];
  window.hub = Object.fromEntries(names.map(name => [name, (...args: unknown[]) => invoke(name, args)])) as unknown as HubApi;
  window.hub.onSuspend = callback => {
    window.addEventListener('hub-suspend', callback);
    return () => window.removeEventListener('hub-suspend', callback);
  };
  window.hub.onControllerCommand = callback => {
    const listener = (event: Event) => callback((event as CustomEvent).detail);
    window.addEventListener('hub-controller-command', listener);
    return () => window.removeEventListener('hub-controller-command', listener);
  };
  window.hubPlatform = 'android';
  window.hubRemoteExit = () => window.HubBridge!.exit();
}
