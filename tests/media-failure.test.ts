import { expect, it } from 'vitest';
import { dashFailure, nativeMediaFailure } from '../src/shared/media-failure';
import type { VideoCapability } from '../src/shared/video-capability';

it('shows finite native and DASH codes while never exposing arbitrary engine messages', () => {
  expect(nativeMediaFailure(3)).toContain('解码失败（MEDIA 3）');
  expect(nativeMediaFailure(3, 'H.264')).toContain('MEDIA 3 · H.264');
  expect(nativeMediaFailure(4, 'AV1')).toContain('MEDIA 4 · AV1');
  expect(nativeMediaFailure(2)).toContain('读取中断（MEDIA 2）');
  expect(dashFailure({ error: { code: 27, message: 'https://secret.example/token' } })).toContain('DASH 27');
  expect(dashFailure({ error: 'mediasource' })).toContain('DASH mediasource');
  for (const error of ['https://secret.example/token', { code: 'secret' }, { code: Infinity }, undefined]) {
    expect(dashFailure({ error })).toBe('视频流加载失败，请重试');
  }
});

it('distinguishes declared hardware/software and WebView limits without claiming successful playback', () => {
  const capabilities: VideoCapability[] = [
    { codec: 'H.264', mse: true, decoder: 2 },
    { codec: 'HEVC', mse: false, decoder: 2 },
    { codec: 'AV1', mse: true, decoder: 1 },
  ];
  const failure = nativeMediaFailure(3, 'H.264', capabilities);
  expect(failure).toContain('H.264：系统声明硬解');
  expect(failure).toContain('HEVC：系统声明硬解、内核未确认支持');
  expect(failure).toContain('AV1：系统声明软解');
  expect(nativeMediaFailure(2, 'H.264', capabilities)).not.toContain('同清晰度');
  const malformed = [{ codec: 'https://private', mse: true, decoder: 2 },
    { codec: 'H.264', mse: true, decoder: 'https://private' }] as unknown as VideoCapability[];
  expect(nativeMediaFailure(3, 'H.264', malformed)).toBe(nativeMediaFailure(3, 'H.264'));
});
