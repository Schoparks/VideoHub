import type { MediaItem, PlaybackSource } from '../../src/shared/types';
import { parseUrl } from './local';

export interface UrlMedia {
  item: MediaItem;
  url: string;
  format: PlaybackSource['format'];
  referer?: string;
  request?: typeof fetch;
  dispose?: () => void | Promise<void>;
}
export type UrlMediaResolver = (item: MediaItem) => Promise<UrlMedia>;

export function httpMediaUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('仅支持不含用户名和密码的 HTTP / HTTPS 地址');
  }
  if (url.href.length > 10000) throw new Error('视频地址过长');
  return url.href;
}

export function mediaFormat(url: string, mime = ''): PlaybackSource['format'] | undefined {
  const path = new URL(url).pathname;
  if (/mpegurl/i.test(mime) || /\.m3u8$/i.test(path)) return 'hls';
  if (/dash\+xml/i.test(mime) || /\.mpd$/i.test(path)) return 'dash';
  if (/video\/x-flv/i.test(mime) || /\.flv$/i.test(path)) return 'flv';
  if (/^video\//i.test(mime) && !/mp2t/i.test(mime)
    || /\.(mp4|m4v|webm|mov|ogv|mkv|avi|mpg|mpeg|mp3|flac|m4a)$/i.test(path)) return 'file';
}

/** Default for non-Electron unit consumers; the desktop injects webpage inspection. */
export const resolveDirectUrl: UrlMediaResolver = async input => {
  const item = parseUrl(input.url || '');
  const format = mediaFormat(item.url!);
  if (!format) throw new Error('需要桌面网页检测才能解析此链接');
  return { item, url: item.url!, format };
};
