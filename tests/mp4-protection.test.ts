import { describe, expect, it } from 'vitest';
import { mp4Protection } from '../electron/playback/mp4-protection';
import { verifiedClearPgcDash } from '../electron/providers/bilibili-pgc-stream';
import { mp4Box as box, mp4Initialization as initialization } from './fixtures/mp4';
const track = (buffer: Buffer, id = 80) => ({
  id, codecs: id > 30000 ? 'mp4a.40.2' : 'avc1.640032',
  base_url: `https://media.bilivideo.com/${id}.m4s`,
  segment_base: { initialization: `0-${buffer.length - 1}` },
});
const response = (data: Buffer) => new Response(new Uint8Array(data), {
  status: 206, headers: { 'content-range': `bytes 0-${data.length - 1}/1000000` },
});

describe('actual MP4 initialization protection', () => {
  it('requires complete sample tables and known clear video/audio entries', () => {
    expect(mp4Protection(initialization())).toBe('clear');
    expect(mp4Protection(initialization('mp4a'))).toBe('clear');
    expect(mp4Protection(Buffer.from('avc1 mp4a'))).toBe('unknown');
    const complete = initialization();
    expect(mp4Protection(complete.subarray(0, complete.length - 1))).toBe('unknown');
    expect(mp4Protection(box('moov', box('trak', Buffer.alloc(0))))).toBe('unknown');
    expect(mp4Protection(initialization('abcd'))).toBe('unknown');
  });
  it('rejects protected sample entries, protection boxes and PSSH', () => {
    expect(mp4Protection(initialization('encv'))).toBe('encrypted');
    expect(mp4Protection(initialization('enca'))).toBe('encrypted');
    expect(mp4Protection(initialization('avc1', box('sinf', box('schm'))))).toBe('encrypted');
    expect(mp4Protection(Buffer.concat([initialization(), box('pssh')]))).toBe('encrypted');
  });
  it('accepts bounded extended sizes and rejects nonzero high words without BigInt', () => {
    const original = initialization();
    const header = Buffer.alloc(16);
    header.writeUInt32BE(1);
    header.write('moov', 4);
    header.writeUInt32BE(original.length + 8, 12);
    const extended = Buffer.concat([header, original.subarray(8)]);
    expect(mp4Protection(extended)).toBe('clear');
    extended.writeUInt32BE(1, 8);
    expect(mp4Protection(extended)).toBe('unknown');
    extended.writeUInt32BE(0xffffffff, 8);
    expect(mp4Protection(extended)).toBe('unknown');
  });
  it('parses box boundaries instead of searching codec-looking byte strings', () => {
    expect(mp4Protection(initialization('avc1', box('avcC', Buffer.from('encv'))))).toBe('clear');
    const extended = initialization();
    extended.writeUInt32BE(1);
    expect(mp4Protection(extended)).toBe('unknown');
    const invalidEntry = initialization();
    invalidEntry.writeUInt32BE(0xffffffff, 48);
    expect(mp4Protection(invalidEntry)).toBe('unknown');
  });
});

describe('PGC ambiguous title flag verification', () => {
  it('validates real initialization bytes without forwarding credentials', async () => {
    const video = initialization(), audio = initialization('mp4a');
    const requests: RequestInit[] = [];
    const dash = { video: [track(video)], audio: [track(audio, 30280)] };
    const result = await verifiedClearPgcDash(dash, (async (url, options) => {
      requests.push(options!);
      return response(String(url).includes('30280') ? audio : video);
    }) as typeof fetch);
    expect(result).toEqual(dash);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const headers = new Headers(request.headers);
      expect(headers.get('Cookie')).toBeNull();
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('Range')).toMatch(/^bytes=0-\d+$/);
      expect(request.redirect).toBe('error');
    }
  });
  it('fails closed for encrypted audio, truncated bodies, ignored ranges and untrusted targets', async () => {
    const video = initialization(), audio = initialization('enca');
    const dash = { video: [track(video)], audio: [track(audio, 30280)] };
    expect(await verifiedClearPgcDash(dash, (async url => response(String(url).includes('30280') ? audio : video)) as typeof fetch))
      .toBeUndefined();
    for (const fetcher of [
      async () => new Response(video),
      async () => new Response(video.subarray(0, 4), { status: 206, headers: { 'content-range': `bytes 0-${video.length - 1}/1000` } }),
      async () => new Response(Buffer.concat([video, video]), { status: 206, headers: { 'content-range': `bytes 0-${video.length - 1}/1000` } }),
    ]) expect(await verifiedClearPgcDash({ video: [track(video)] }, fetcher as typeof fetch)).toBeUndefined();
    const forbidden = { ...track(video), base_url: 'https://127.0.0.1/secret' };
    expect(await verifiedClearPgcDash({ video: [forbidden] }, (async () => { throw new Error('must not request'); }) as typeof fetch))
      .toBeUndefined();
  });
  it('retains only verified qualities and never probes a declared encryption technology', async () => {
    const clear = initialization();
    const declared = { ...track(clear, 112), drm_tech_type: 2 };
    let calls = 0;
    const result = await verifiedClearPgcDash({ video: [declared, track(clear)] }, (async () => {
      calls++;
      return response(clear);
    }) as typeof fetch);
    expect(calls).toBe(1);
    expect(result?.video.map((entry: any) => entry.id)).toEqual([80]);
  });
});
