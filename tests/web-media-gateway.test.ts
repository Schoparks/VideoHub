import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { MediaGateway } from '../electron/playback/gateway';
import { readManifest } from '../electron/playback/read-manifest';

describe('webpage media transport', () => {
  it('rewrites adaptive manifests, keeps request context and limits template parameters', async () => {
    const requests: { path?: string; referer?: string; range?: string; cookie?: string }[] = [];
    const server = createServer((req, res) => {
      requests.push({ path: req.url, referer: req.headers.referer, range: req.headers.range, cookie: req.headers.cookie });
      if (req.url === '/root.mpd') {
        res.setHeader('Content-Type', 'application/dash+xml');
        res.end('<MPD><Period><AdaptationSet><SegmentTemplate media="part-$Number%05d$.m4s?token=fixture" initialization="init.mp4"/><Representation id="v"/></AdaptationSet></Period></MPD>');
      } else if (req.url === '/root.m3u8') {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.end('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\npart.m4s?token=fixture\n');
      } else { res.setHeader('Content-Type', 'video/mp4'); res.end('fixture segment'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const info = server.address();
    if (!info || typeof info === 'string') throw new Error('no fixture server');
    const origin = `http://127.0.0.1:${info.port}`;
    const gateway = new MediaGateway();
    const request = vi.fn(fetch);
    try {
      await gateway.start();
      const options = { session: 'web-test', referer: `${origin}/watch`, request };
      const dash = gateway.register({ ...options, url: `${origin}/root.mpd` });
      const manifest = await fetch(dash).then(response => response.text());
      expect(manifest).not.toContain(origin);
      const template = /media="([^"]+)"/.exec(manifest)![1].replaceAll('&amp;', '&');
      const segment = template.replace('$Number%05d$', '00003');
      expect(await fetch(segment, { headers: { Range: 'bytes=0-9', Cookie: 'renderer-secret' } }).then(response => response.text()))
        .toBe('fixture segment');
      expect(requests.at(-1)).toEqual({ path: '/part-00003.m4s?token=fixture', referer: `${origin}/watch`, range: 'bytes=0-9', cookie: undefined });
      const calls = request.mock.calls.length;
      expect((await fetch(template.replace('$Number%05d$', 'arbitrary'))).status).toBe(400);
      expect(request.mock.calls.length).toBe(calls);
      const hls = gateway.register({ ...options, url: `${origin}/root.m3u8` });
      const playlist = await fetch(hls).then(response => response.text());
      const child = playlist.split('\n').find(line => line.startsWith('http'))!;
      await fetch(child);
      expect(requests.at(-1)?.referer).toBe(`${origin}/watch`);
      expect(requests.at(-1)?.path).toBe('/part.m4s?token=fixture');
      gateway.release('web-test');
      expect((await fetch(segment)).status).toBe(404);
      expect((await fetch(child)).status).toBe(404);
    } finally {
      await gateway.stop();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('bounds manifest bodies while reading and cancels oversized streams', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(2000001));
      controller.enqueue(new Uint8Array(2000001));
    }, cancel });
    await expect(readManifest(new Response(stream), new AbortController())).rejects.toThrow('过大');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await readManifest(new Response('#EXTM3U'), new AbortController())).toBe('#EXTM3U');
    await expect(readManifest(new Response(null), new AbortController())).rejects.toThrow('为空');
  });
});
