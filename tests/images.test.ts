import { describe, expect, it } from 'vitest';
import { coverUrl, normalizeImageUrl } from '../src/shared/images';
import { fetchCover } from '../electron/images';

describe('Bilibili public artwork', () => {
  it('upgrades API HTTP artwork and uses the desktop artwork transport', () => {
    expect(normalizeImageUrl('http://i0.hdslb.com/bfs/archive/a.jpg')).toBe('https://i0.hdslb.com/bfs/archive/a.jpg');
    expect(coverUrl('//i0.hdslb.com/a.jpg', true)).toBe('yingji://app/image?url=https%3A%2F%2Fi0.hdslb.com%2Fa.jpg');
    expect(coverUrl('https://example.com/a.jpg', true)).toBe('https://example.com/a.jpg');
    expect(coverUrl('javascript:alert(1)', true)).toBeUndefined();
  });
  it('sends artwork headers without account credentials', async () => {
    let seen: RequestInit | undefined;
    const response = await fetchCover('http://i0.hdslb.com/a.jpg', (async (url, init) => {
      expect(url).toBe('https://i0.hdslb.com/a.jpg'); seen = init;
      return new Response(new Uint8Array([1,2,3]), { headers: { 'content-type': 'image/jpeg' } });
    }) as typeof fetch);
    expect(response.status).toBe(200);
    expect(await response.arrayBuffer()).toHaveProperty('byteLength', 3);
    expect(seen?.headers).toMatchObject({ Referer: 'https://www.bilibili.com/' });
    expect(seen?.headers).not.toHaveProperty('Cookie');
    expect(seen?.redirect).toBe('error');
  });
  it('rejects arbitrary targets, deceptive hosts, credentials and non-images', async () => {
    for (const url of ['https://127.0.0.1/secret','https://hdslb.com.evil.test/a','https://i0.hdslb.com:8443/a','https://user:password@i0.hdslb.com/a','file:///secret']) {
      expect((await fetchCover(url, (()=>{throw new Error('must not fetch');}) as typeof fetch)).status).toBe(403);
    }
    expect((await fetchCover('https://i0.hdslb.com/a', (async()=>new Response('<html>blocked</html>', {headers:{'content-type':'text/html'}})) as typeof fetch)).status).toBe(502);
  });
});
