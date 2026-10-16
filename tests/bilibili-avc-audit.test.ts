import { afterEach, expect, it, vi } from 'vitest';
import { auditAvc } from '../scripts/bilibili-avc-audit';
import { mp4Box, mp4Initialization } from './fixtures/mp4';

afterEach(() => vi.unstubAllGlobals());

// High-profile SPS: progressive 4K, 8-bit 4:2:0, four reference frames, no cropping.
function header() {
  const ue = (value: number) => {
    const binary = (value + 1).toString(2);
    return '0'.repeat(binary.length - 1) + binary;
  };
  let bits = [ue(0), ue(1), ue(0), ue(0), '0', '0', ue(0), ue(0), ue(0),
    ue(4), '0', ue(239), ue(134), '1', '1', '0', '0', '1'].join('');
  bits = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
  const sps = Buffer.from([0x67, 100, 0, 51,
    ...bits.match(/.{8}/g)!.map(value => parseInt(value, 2))]);
  const config = Buffer.concat([Buffer.from([1, 100, 0, 51, 255, 225, 0, sps.length]), sps]);
  return mp4Initialization('avc1', mp4Box('avcC', config));
}
const track = (size: number) => ({ baseUrl: 'https://video.bilivideo.com/header',
  SegmentBase: { Initialization: `0-${size - 1}` } });

it('reads only the bounded clear initialization and reports actual SPS parameters without credentials', async () => {
  const bytes = header();
  const fetcher = vi.fn(async () => new Response(bytes, { status: 206,
    headers: { 'content-range': `bytes 0-${bytes.length - 1}/999999` } }));
  vi.stubGlobal('fetch', fetcher);
  expect(await auditAvc(track(bytes.length))).toMatchObject({
    status: 'read', codec: 'avc1.640033', profile: 100, level: 51, references: 4,
    lumaDepth: 8, chromaDepth: 8, chroma: 1, width: 3840, height: 2160,
  });
  const options = (fetcher.mock.calls[0] as unknown as [URL, RequestInit])[1];
  const headers = new Headers(options.headers);
  expect(headers.get('Range')).toBe(`bytes=0-${bytes.length - 1}`);
  expect(headers.has('Cookie')).toBe(false);
  expect(options.redirect).toBe('error');
});

it('does not fetch unsupported addresses or oversized headers', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await auditAvc(track(65537))).toEqual({ status: 'unavailable' });
  expect(await auditAvc({ ...track(10), baseUrl: 'https://other.example/header' })).toEqual({ status: 'unavailable' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects full-file responses, excess bytes and protected descriptions without claiming parsed support', async () => {
  const bytes = header();
  for (const response of [new Response(bytes), new Response(Buffer.concat([bytes, bytes]), {
    status: 206, headers: { 'content-range': `bytes 0-${bytes.length - 1}/999999` },
  })]) {
    vi.stubGlobal('fetch', async () => response);
    expect(await auditAvc(track(bytes.length))).toEqual({ status: 'unavailable' });
  }
  const encrypted = mp4Initialization('encv');
  vi.stubGlobal('fetch', async () => new Response(encrypted, { status: 206,
    headers: { 'content-range': `bytes 0-${encrypted.length - 1}/999999` } }));
  expect(await auditAvc(track(encrypted.length))).toEqual({ status: 'unavailable' });
});
