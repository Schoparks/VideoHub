import { describe, expect, it } from 'vitest';
import { httpMediaUrl, mediaFormat, resolveDirectUrl } from '../electron/providers/url-media';
import { parseUrl } from '../electron/providers/local';

describe('generic video page references', () => {
  it('accepts arbitrary HTTP pages while preserving stable original identities', () => {
    const page = parseUrl('https://small.example/watch?id=123');
    expect(page.source).toBe('url');
    expect(page.url).toBe('https://small.example/watch?id=123');
    expect(parseUrl(page.url!).id).toBe(page.id);
    expect(parseUrl('https://www.bilibili.com/read/cv123').source).toBe('url');
    expect(parseUrl('https://www.bilibili.com/video/BV17x411w7KC').source).toBe('bilibili');
  });

  it('does not reject playable URL identities because their display escapes are malformed', () => {
    expect(parseUrl('https://small.example/%zz').title).toBe('%zz');
  });

  it('recognizes manifests, extensionless media responses and excludes transport segments', () => {
    expect(mediaFormat('https://media.example/stream', 'application/vnd.apple.mpegurl')).toBe('hls');
    expect(mediaFormat('https://media.example/stream', 'application/dash+xml')).toBe('dash');
    expect(mediaFormat('https://media.example/stream', 'video/webm')).toBe('file');
    expect(mediaFormat('https://media.example/stream', 'video/mp2t')).toBeUndefined();
    expect(mediaFormat('https://small.example/watch', 'text/html')).toBeUndefined();
    expect(mediaFormat('https://media.example/film.m3u8?token=a#chapter')).toBe('hls');
  });

  it('resolves relative candidates and rejects non-network and credential-bearing URLs', () => {
    expect(httpMediaUrl('../v.mp4', 'https://small.example/watch/a')).toBe('https://small.example/v.mp4');
    for (const url of ['blob:https://small.example/1', 'file:///secret', 'javascript:alert(1)', 'https://a:b@small.example/v.mp4']) {
      expect(() => httpMediaUrl(url)).toThrow();
    }
  });

  it('keeps native direct playback while requiring desktop inspection for pages', async () => {
    const item = parseUrl('https://media.example/clip.webm');
    expect(await resolveDirectUrl(item)).toMatchObject({ item, url: item.url, format: 'file' });
    await expect(resolveDirectUrl(parseUrl('https://small.example/watch'))).rejects.toThrow('网页检测');
  });
});
