import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { USER_AGENT } from '../protocol/http';
import { rewriteWebDash } from './web-dash';
import { createMediaUrlTemplate, type MediaUrlTemplate } from './url-template';
import { readManifest } from './read-manifest';
type Resource = { session: string; path?: string; url?: string; backups?: string[]; text?: string; mime?: string; bili?: boolean;
  referer?: string; request?: typeof fetch; template?: MediaUrlTemplate };
export function parseRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0) throw new Error('Invalid range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw new Error('Invalid range');
  return { start, end };
}
export function rewriteHls(manifest: string, base: string, register: (url: string) => string) {
  const absolute = (uri: string) => {
    const u = new URL(uri, base);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('不支持的播放列表协议');
    return register(u.href);
  };
  return manifest.split('\n').map(line => {
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${absolute(uri)}"`);
    return line.trim() ? absolute(line.trim()) : line;
  }).join('\n');
}
export class MediaGateway {
  private resources = new Map<string, Resource>();
  private addresses = new Map<string, string>();
  private controllers = new Map<string, Set<AbortController>>();
  readonly server = createServer((req, res) => { void this.handle(req, res); });
  origin = '';
  async start() {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('无法启动媒体服务');
    this.origin = `http://127.0.0.1:${address.port}`;
  }
  register(resource: Resource) {
    if (resource.url) {
      const url = new URL(resource.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('不支持的媒体协议');
      const key = `${resource.session}:${resource.url}`;
      if (this.addresses.has(key)) return this.addresses.get(key)!;
    }
    if (this.resources.size > 20000) throw new Error('播放列表过大，请重新打开');
    const address = `${this.origin}/media/${randomUUID()}`;
    this.resources.set(new URL(address).pathname, resource);
    if (resource.url) this.addresses.set(`${resource.session}:${resource.url}`, address);
    return address;
  }
  registerTemplate(resource: Resource) {
    const template = createMediaUrlTemplate(resource.url!);
    return `${this.register({ ...resource, template })}/${template.suffix}`;
  }
  release(session: string) {
    this.controllers.get(session)?.forEach(c => c.abort()); this.controllers.delete(session);
    for (const [key, resource] of this.resources) if (resource.session === session) this.resources.delete(key);
    for (const key of this.addresses.keys()) if (key.startsWith(`${session}:`)) this.addresses.delete(key);
  }
  async stop() { for (const key of this.controllers.keys()) this.release(key); this.server.closeAllConnections(); await new Promise<void>(r => this.server.close(() => r())); }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405); res.end(); return; }
    const path = (req.url || '').split('?')[0];
    let resource = this.resources.get(path);
    if (!resource) {
      const parts = path.split('/');
      const base = this.resources.get(parts.slice(0, 3).join('/'));
      if (base?.template) {
        try { resource = { ...base, url: base.template.expand(parts.slice(3)) }; }
        catch { res.writeHead(400); res.end(); return; }
      }
    }
    if (!resource) { res.writeHead(404); res.end(); return; }
    try {
      if (resource.text !== undefined) { res.setHeader('Content-Type', resource.mime || 'text/plain'); res.end(req.method === 'HEAD' ? undefined : resource.text); return; }
      if (resource.path) {
        const info = await stat(resource.path); let range;
        try { range = parseRange(req.headers.range, info.size); } catch { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
        const mime = resource.path.toLowerCase().endsWith('.webm') ? 'video/webm' : resource.path.toLowerCase().endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4';
        res.setHeader('Content-Type', mime); res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', range ? range.end - range.start + 1 : info.size);
        if (range) res.writeHead(206, { 'Content-Range': `bytes ${range.start}-${range.end}/${info.size}` });
        if (req.method === 'HEAD') { res.end(); return; }
        await pipeline(createReadStream(resource.path, range || undefined), res); return;
      }
      const controller = new AbortController();
      const group = this.controllers.get(resource.session) || new Set<AbortController>();
      group.add(controller); this.controllers.set(resource.session, group);
      res.on('close', () => { controller.abort(); group.delete(controller); });
      const timeout = setTimeout(() => controller.abort(), 20000);
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
      // Account cookies/tokens never enter this gateway. Webpage cookies stay in their isolated browser session.
      if (resource.bili) headers.Referer = 'https://www.bilibili.com/';
      else if (resource.referer) headers.Referer = resource.referer;
      if (req.headers.range) headers.Range = req.headers.range;
      let upstream: Response;
      try { upstream = await (resource.request || fetch)(resource.url!, { headers, signal: controller.signal, method: req.method }); } finally { clearTimeout(timeout); }
      if (!upstream.ok) { res.writeHead(upstream.status); res.end('媒体源暂时不可用'); await upstream.body?.cancel(); return; }
      const upstreamUrl = upstream.url || resource.url!;
      const mime = upstream.headers.get('content-type') || '';
      const hls = /mpegurl/i.test(mime) || /\.m3u8(?:$|\?)/i.test(upstreamUrl);
      if (hls && req.method !== 'HEAD') {
        const body = await readManifest(upstream, controller);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.end(rewriteHls(body, upstreamUrl, url => this.register({ ...resource, url, template: undefined }))); return;
      }
      if ((/dash\+xml/i.test(mime) || /\.mpd(?:$|\?)/i.test(upstreamUrl)) && req.method !== 'HEAD') {
        const body = await readManifest(upstream, controller);
        res.setHeader('Content-Type', 'application/dash+xml');
        res.end(rewriteWebDash(body, upstreamUrl, url => this.register({ ...resource, url, template: undefined }),
          url => this.registerTemplate({ ...resource, url }))); return;
      }
      for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const value = upstream.headers.get(key); if (value) res.setHeader(key, value); }
      res.writeHead(upstream.status);
      if (req.method === 'HEAD' || !upstream.body) res.end();
      else await pipeline(Readable.fromWeb(upstream.body as any), res);
    } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
  }
}
