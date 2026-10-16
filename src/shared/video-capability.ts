export type VideoCodec = 'H.264' | 'HEVC' | 'AV1';
export interface VideoCapability {
  codec: VideoCodec;
  mse: boolean;
  /** System declaration only: 0 unknown, 1 software, 2 hardware. */
  decoder: 0 | 1 | 2;
}

/** Only finite labels may reach the error page, never codec strings or engine messages. */
export function videoCapabilitySummary(values?: VideoCapability[]) {
  if (!Array.isArray(values)) return '';
  const labels: string[] = [];
  for (const codec of ['H.264', 'HEVC', 'AV1'] as const) {
    const value = values.find(entry => entry?.codec === codec);
    if (!value || typeof value.mse !== 'boolean' || ![0, 1, 2].includes(value.decoder)) continue;
    const decoder = value.decoder === 2 ? '系统声明硬解'
      : value.decoder === 1 ? '系统声明软解' : '系统未确认解码支持';
    labels.push(`${codec}：${decoder}${value.mse ? '' : '、内核未确认支持'}`);
  }
  return labels.length ? `。同清晰度能力：${labels.join('；')}` : '';
}
