import { contextBridge, ipcRenderer } from 'electron';
const methods = ['bootstrap','browse','folders','detail','login','pollLogin','cancelLogin','logout','addLocal','rescan','openUrl','resolve','cancelUrlResolution','release','progress','danmaku','watchLater','favorite','queue','preferences','fullscreen','getFullscreen','openOfficial',
  'related', 'controllerStatus', 'controllerEnable', 'controllerReply'] as const;
const api = Object.fromEntries(methods.map(name => [name, async (...args: unknown[]) => {
  const reply = await ipcRenderer.invoke(`hub:${name}`, args);
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}]));
contextBridge.exposeInMainWorld('hub', Object.freeze({
  ...api,
  onControllerCommand: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('controller:command', listener);
    return () => ipcRenderer.removeListener('controller:command', listener);
  },
  onSuspend: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('system:suspend', listener);
    return () => ipcRenderer.removeListener('system:suspend', listener);
  },
  onFullscreen: (callback: (value: boolean) => void) => {
    const listener = (_event: unknown, value: unknown) => { if (typeof value === 'boolean') callback(value); };
    ipcRenderer.on('window:fullscreen', listener);
    return () => ipcRenderer.removeListener('window:fullscreen', listener);
  },
}));
