import { afterEach, expect, it, vi } from 'vitest';
import { androidDashRange } from '../src/android/dash-range';

afterEach(() => vi.unstubAllGlobals());

it('moves the registered Android media range into the local URL without mutating the request', async () => {
  vi.stubGlobal('window', { hubPlatform: 'android' });
  const request = { url: 'https://app.yingji.local/media/token?other=1', headers: { Range: 'bytes=917-1712', Accept: '*/*' } };
  const adapted = await androidDashRange(request);
  expect(adapted.url).toBe('https://app.yingji.local/media/token?other=1&range=917-1712');
  expect(adapted.headers).toEqual({ Accept: '*/*' });
  expect(request.headers.Range).toBe('bytes=917-1712');
  expect(adapted).not.toBe(request);
});

it('preserves desktop, remote, malformed and non-media requests', async () => {
  for (const platform of ['android', 'electron']) {
    vi.stubGlobal('window', { hubPlatform: platform });
    for (const url of ['https://example.com/media/token', 'https://app.yingji.local/backend/entry.js']) {
      const request = { url, headers: { Range: 'bytes=10-20' } };
      expect(await androidDashRange(request)).toBe(request);
    }
  }
  vi.stubGlobal('window', { hubPlatform: 'android' });
  for (const range of ['bytes=1-2,4-5', 'bytes=-20', 'http://remote.test', 'invalid']) {
    const request = { url: 'https://app.yingji.local/media/token', headers: { Range: range } };
    expect(await androidDashRange(request)).toBe(request);
  }
  vi.stubGlobal('window', { hubPlatform: 'electron' });
  const desktop = { url: 'https://app.yingji.local/media/token', headers: { Range: 'bytes=1-2' } };
  expect(await androidDashRange(desktop)).toBe(desktop);
});
