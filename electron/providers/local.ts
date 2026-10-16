import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { MediaItem } from '../../src/shared/types';
const extensions = new Set(['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.mpg', '.mpeg', '.ts', '.m2ts', '.flv', '.ogv', '.mp3', '.flac', '.m4a']);
export async function scanLocal(paths: string[]): Promise<MediaItem[]> {
  const items: MediaItem[] = [], visited = new Set<string>();
  async function walk(path: string, depth: number) {
    if (depth > 16 || items.length >= 20000) return;
    const canonical = await realpath(path);
    if (visited.has(canonical)) return; visited.add(canonical);
    const info = await stat(canonical);
    if (info.isDirectory()) {
      for (const child of await readdir(canonical, { withFileTypes: true })) {
        if (child.isSymbolicLink() || child.name.startsWith('.')) continue;
        try { await walk(join(canonical, child.name), depth + 1); } catch { /* unreadable entries are skipped; root errors propagate */ }
      }
    } else if (extensions.has(extname(canonical).toLowerCase())) {
      items.push({ id: `local:${createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`, source: 'local', kind: 'video', title: basename(canonical, extname(canonical)), author: extname(canonical).slice(1).toUpperCase(), path: canonical, addedAt: Date.now() });
    }
  }
  for (const path of paths) await walk(path, 0);
  return items;
}
export function parseUrl(input: string): MediaItem {
  const raw = input.trim();
  if (/^BV[\da-zA-Z]{10}$/.test(raw)) return { id: `bili:${raw}`, source: 'bilibili', kind: 'video', title: raw, bvid: raw };
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('请输入完整的 http(s) 地址或 BV 号'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持不含用户名和密码的 HTTP / HTTPS 地址');
  if (url.hostname === 'www.bilibili.com' || url.hostname === 'bilibili.com' || url.hostname === 'm.bilibili.com') {
    const bv = /\/video\/(BV[\da-zA-Z]{10})/.exec(url.pathname)?.[1];
    if (bv) return { id: `bili:${bv}`, source: 'bilibili', kind: 'video', title: bv, bvid: bv };
    const ep = /\/bangumi\/play\/(ep|ss)(\d+)/.exec(url.pathname);
    if (ep) return { id: `${ep[1]}:${ep[2]}`, source: 'bilibili', kind: 'season', title: 'B 站影视', ...(ep[1] === 'ss' ? { seasonId: Number(ep[2]) } : { episodeId: Number(ep[2]) }) };
  }
  if (url.hostname === 'live.bilibili.com') {
    const id = /^\/(\d+)/.exec(url.pathname)?.[1];
    if (id) return { id: `live:${id}`, source: 'bilibili', kind: 'live', roomId: Number(id), title: `直播间 ${id}` };
  }
  let title = url.pathname.split('/').pop() || url.hostname;
  try { title = decodeURIComponent(title); } catch { /* Malformed display escapes must not reject a valid URL. */ }
  return { id: `url:${createHash('sha256').update(url.href).digest('hex').slice(0, 24)}`, source: 'url', kind: 'video', title, author: url.hostname, url: url.href };
}
