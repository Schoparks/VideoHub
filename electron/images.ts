import { isBilibiliImageHost, normalizeImageUrl } from '../src/shared/images';
import { USER_AGENT } from './protocol/http';

const LIMIT = 12 * 1024 * 1024;
/** Public artwork only: never forward account credentials or follow arbitrary redirects. */
export async function fetchCover(input: string, fetcher: typeof fetch = fetch): Promise<Response> {
  const address = normalizeImageUrl(input);
  if (!address || !isBilibiliImageHost(new URL(address).hostname) || new URL(address).port) return new Response('', { status: 403 });
  try {
    const upstream = await fetcher(address, { headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/*' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    const mime = upstream.headers.get('content-type')?.split(';')[0] || '';
    if (!upstream.ok || !/^image\/(jpeg|png|webp|avif|gif)$/.test(mime) || Number(upstream.headers.get('content-length')) > LIMIT) {
      await upstream.body?.cancel(); return new Response('', { status: 502 });
    }
    const reader = upstream.body?.getReader();
    if (!reader) return new Response('', { status: 502 });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > LIMIT) { await reader.cancel(); return new Response('', { status: 413 }); }
      chunks.push(value);
    }
    return new Response(Buffer.concat(chunks), { headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('', { status: 502 }); }
}
