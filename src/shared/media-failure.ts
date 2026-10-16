import { videoCapabilitySummary, type VideoCapability, type VideoCodec } from './video-capability';

/** Display finite diagnostic codes, never engine messages containing media addresses. */
export function dashFailure(event: { error?: unknown } | undefined) {
  const error = event?.error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const suffix = typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 1000
    ? `（DASH ${code}）` : typeof error === 'string'
      && ['capability', 'mediasource', 'key_session', 'key_message'].includes(error) ? `（DASH ${error}）` : '';
  return `视频流加载失败${suffix}，请重试`;
}

export function nativeMediaFailure(code?: number, codec?: VideoCodec, capabilities?: VideoCapability[]) {
  const encoding = codec && ['H.264', 'HEVC', 'AV1'].includes(codec) ? ` · ${codec}` : '';
  if (code === 2) return '视频读取中断（MEDIA 2），请检查网络后重试';
  const detail = videoCapabilitySummary(capabilities);
  if (code === 3) return `设备解码失败（MEDIA 3${encoding}），请尝试其他清晰度${detail}`;
  if (code === 4) return `设备不支持当前媒体（MEDIA 4${encoding}），请尝试其他清晰度${detail}`;
  return '无法解码或读取此视频。请重试；本地文件建议使用 H.264/AAC MP4 或 WebM。';
}
