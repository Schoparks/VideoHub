import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { MediaItem } from '../../src/shared/types';
import { httpMediaUrl, mediaFormat, resolveDirectUrl, type UrlMedia } from './url-media';
import { inspectWebMedia, type WebMediaCandidate } from './web-media-script';
import { createWebMediaRequest } from './web-media-request';
import { selectWebMediaCandidate } from './web-media-selection';
import { WebMediaAvailability } from './web-media-availability';

const pending = new Map<AbortController, Promise<UrlMedia>>();
export async function cancelWebMediaResolution(): Promise<void> {
  const requests = [...pending];
  for (const [controller] of requests) controller.abort();
  await Promise.allSettled(requests.map(([, request]) => request));
}

/** Remote pages never share the application session, preload, account vault or focus. */
export async function resolveWebMedia(input: MediaItem): Promise<UrlMedia> {
  const controller = new AbortController();
  const request = probeWebMedia(input, controller.signal);
  pending.set(controller, request);
  try { return await request; }
  finally { pending.delete(controller); }
}

async function probeWebMedia(input: MediaItem, signal: AbortSignal): Promise<UrlMedia> {
  const address = httpMediaUrl(input.url || '');
  if (mediaFormat(address)) return resolveDirectUrl(input);
  const isolated = session.fromPartition(`web-media-${randomUUID()}`, { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const probe = new BrowserWindow({
    show: false, focusable: false, skipTaskbar: true, width: 1280, height: 720,
    webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, disableDialogs: true, backgroundThrottling: false,
    },
  });
  probe.webContents.setAudioMuted(true);
  probe.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  probe.webContents.on('will-frame-navigate', event => {
    try { httpMediaUrl(event.url); } catch { event.preventDefault(); }
  });
  const abort = () => { if (!probe.isDestroyed()) probe.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  isolated.on('will-download', event => event.preventDefault());
  const availability = new WebMediaAvailability();
  const network = createWebMediaRequest(isolated, (id, from, to) => availability.redirect(id, from, to));
  const candidates = new Map<string, WebMediaCandidate>();
  const add = (value: WebMediaCandidate, target = candidates) => {
    try {
      const url = httpMediaUrl(value.url);
      const referer = httpMediaUrl(value.referer);
      const mime = value.mime || candidates.get(url)?.mime;
      if (!Number.isFinite(value.score) || target.size >= 200 || !mediaFormat(url, mime)) return;
      if (value.visibleArea !== undefined && (!Number.isFinite(value.visibleArea) || value.visibleArea < 0)) return;
      const previous = target.get(url);
      target.set(url, { ...value, url, mime, referer, score: Math.max(value.score, previous?.score ?? -Infinity),
        visibleArea: value.visibleArea === undefined ? previous?.visibleArea
          : Math.max(value.visibleArea, previous?.visibleArea ?? 0) });
    } catch { /* Page metadata is untrusted, invalid candidates are ignored. */ }
  };
  isolated.webRequest.onHeadersReceived((details, callback) => {
    const mime = Object.entries(details.responseHeaders || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.[0] || '';
    const format = mediaFormat(details.url, mime);
    if (format || details.resourceType === 'media' || availability.hasRedirect(details.id)) {
      availability.observe(details.id, details.url, details.statusCode);
    }
    if (format && details.statusCode >= 200 && details.statusCode < 300) {
      add({ url: details.url, mime, score: format === 'hls' || format === 'dash' ? 900
        : details.resourceType === 'media' ? 750 : 150, referer: details.referrer || address });
    }
    callback({});
  });
  const dispose = async () => {
    if (!probe.isDestroyed()) probe.destroy();
    network.dispose();
    availability.clear();
    isolated.webRequest.onHeadersReceived(null);
    await isolated.clearStorageData();
    await isolated.clearCache();
  };
  let title = input.title, settled = 0, unavailableFound = false, selected: WebMediaCandidate | undefined;
  try {
    void probe.loadURL(address).catch(() => {});
    const deadline = Date.now() + 20000;
    while (!probe.isDestroyed() && Date.now() < deadline) {
      const frames = probe.webContents.mainFrame.framesInSubtree.slice(0, 20);
      const inspections = await Promise.race([
        Promise.allSettled(frames.map(frame => frame.executeJavaScript(`(${inspectWebMedia.toString()})()`))),
        new Promise<[]> (resolve => setTimeout(() => resolve([]), 400)),
      ]);
      const pageCandidates = new Map<string, WebMediaCandidate>();
      for (let index = 0; index < inspections.length; index++) {
        const result = inspections[index];
        if (result.status !== 'fulfilled' || !result.value || typeof result.value !== 'object') continue;
        const inspection = result.value as { title?: unknown; candidates?: unknown };
        if (index === 0 && typeof inspection.title === 'string' && inspection.title.trim()) title = inspection.title.slice(0, 500);
        if (Array.isArray(inspection.candidates)) inspection.candidates.slice(0, 100).forEach(value => add(value, pageCandidates));
      }
      const available = (values: Iterable<WebMediaCandidate>) => [...values].filter(value => !availability.isUnavailable(value.url));
      unavailableFound = [...candidates.values(), ...pageCandidates.values()].some(value => availability.isUnavailable(value.url));
      selected = selectWebMediaCandidate(available(candidates.values()), available(pageCandidates.values()));
      if (selected && selected.visibleArea !== 0) {
        settled ||= Date.now();
        if (Date.now() - settled >= 800) break;
      } else settled = 0;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (signal.aborted) throw new Error('链接解析已取消');
    const candidate = selected;
    if (!candidate) throw new Error(unavailableFound ? '此网页的视频资源已失效，请刷新原网页后重试'
      : '此网页尚未检测到可播放视频；请使用含视频的页面或媒体直链');
    const request = network.request;
    const origin = new URL(candidate.referer);
    const target = new URL(candidate.url);
    const referer = origin.protocol === 'https:' && target.protocol === 'http:' ? undefined
      : origin.origin === target.origin ? origin.href : `${origin.origin}/`;
    probe.destroy();
    return {
      item: { ...input, title }, url: candidate.url, format: mediaFormat(candidate.url, candidate.mime)!,
      referer, request, dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
