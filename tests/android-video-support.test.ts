import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('requires both layers for selection while retaining independent declarations and caching tuples', async () => {
  const score = vi.fn((_json: string) => 2);
  const mse = vi.fn((type: string) => type.includes('avc1'));
  vi.stubGlobal('window', { Backend: { videoSupport: score } });
  vi.stubGlobal('MediaSource', { isTypeSupported: mse });
  const { androidVideoSupport } = await import('../android/backend/video-support');
  const track = { id: 120, codecs: 'hev1.1.6.L153.B0', width: 3840, height: 2160, bandwidth: 5000000 };
  expect(androidVideoSupport(track)).toBe(0);
  expect(androidVideoSupport.inspect!(track)).toEqual({ mse: false, decoder: 2 });
  expect(score).toHaveBeenCalledOnce();
  const avc = { ...track, codecs: 'avc1.640033', frame_rate: '60000/1001' };
  expect(androidVideoSupport(avc)).toBe(2);
  expect(androidVideoSupport(avc)).toBe(2);
  expect(score).toHaveBeenCalledTimes(2);
  expect(JSON.parse(score.mock.calls[1][0]!)).toEqual({ codec: avc.codecs, width: 3840, height: 2160, frameRate: '60000/1001' });
});

it('retains a native declaration after an unavailable MSE query without selecting that codec', async () => {
  vi.stubGlobal('window', { Backend: { videoSupport: () => 1 } });
  vi.stubGlobal('MediaSource', { isTypeSupported: () => { throw new Error('unavailable'); } });
  const { androidVideoSupport } = await import('../android/backend/video-support');
  const track = { id: 120, codecs: 'av01.0.12M.08', width: 3840, height: 2160, bandwidth: 1000000 };
  expect(androidVideoSupport(track)).toBe(0);
  expect(androidVideoSupport.inspect!(track)).toEqual({ mse: false, decoder: 1 });
});

it('treats unavailable or malformed capability responses as unknown without claiming compatibility', async () => {
  vi.stubGlobal('window', { Backend: { videoSupport: () => 99 } });
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true });
  const { androidVideoSupport } = await import('../android/backend/video-support');
  expect(androidVideoSupport({ id: 80, codecs: 'avc1.640028', width: 1920, height: 1080, bandwidth: 1000000 })).toBe(0);
});
