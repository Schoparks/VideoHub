/** Resolution caps do not rank bitrate and frame-rate variants of the same resolution. */
export const bilibiliQualityLimits = [
  { id: 0, label: '不限' },
  { id: 120, label: '4K' },
  { id: 80, label: '1080P' },
  { id: 64, label: '720P' },
  { id: 32, label: '480P' },
  { id: 16, label: '360P' },
  { id: 6, label: '240P' },
] as const;

export type BilibiliQualityLimit = typeof bilibiliQualityLimits[number]['id'];
export interface BilibiliQualityPreferences {
  bilibiliMaxQuality: BilibiliQualityLimit | 116 | 112 | 74;
  bilibiliQualityMode: 'highest' | 'remember';
  bilibiliRememberedQuality: number;
}

export const defaultBilibiliQuality: BilibiliQualityPreferences = {
  bilibiliMaxQuality: 0,
  bilibiliQualityMode: 'highest',
  bilibiliRememberedQuality: 0,
};

/** Also normalizes old/malformed disk values without resetting other preferences. */
export function restoreBilibiliQuality(value?: Partial<BilibiliQualityPreferences>): BilibiliQualityPreferences {
  const remembered = value?.bilibiliRememberedQuality;
  const old = value?.bilibiliMaxQuality;
  const limit = old === 116 || old === 112 ? 80 : old === 74 ? 64 : old;
  return {
    bilibiliMaxQuality: bilibiliQualityLimits.some(choice => choice.id === limit) ? limit! : 0,
    bilibiliQualityMode: value?.bilibiliQualityMode === 'remember' ? 'remember' : 'highest',
    bilibiliRememberedQuality: Number.isInteger(remembered) && remembered! > 0 && remembered! <= 127
      ? remembered! : 0,
  };
}

export function bilibiliQualityCeiling(value: Partial<BilibiliQualityPreferences>) {
  const limit = restoreBilibiliQuality(value).bilibiliMaxQuality;
  return limit === 80 ? 116 : limit === 64 ? 74 : limit || 127;
}

export function bilibiliResolution(id: number) {
  return ({ 6: 240, 16: 360, 32: 480, 64: 720, 74: 720, 80: 1080,
    100: 1080, 112: 1080, 116: 1080, 120: 2160, 125: 2160, 126: 2160, 127: 4320 } as Record<number, number>)[id] || Infinity;
}

export function requestedBilibiliQuality(value: Partial<BilibiliQualityPreferences>, explicit?: number) {
  const preferences = restoreBilibiliQuality(value);
  const preferred = explicit ?? (preferences.bilibiliQualityMode === 'remember'
    ? preferences.bilibiliRememberedQuality || 127 : 127);
  const ceiling = bilibiliQualityCeiling(preferences);
  return bilibiliResolution(preferred) <= bilibiliResolution(ceiling) ? preferred : ceiling;
}

export function allowedBilibiliQualities<T extends { id: number }>(qualities: T[], value: Partial<BilibiliQualityPreferences>) {
  const ceiling = bilibiliQualityCeiling(value);
  return qualities.filter(quality => {
    if (!value.bilibiliMaxQuality) return true;
    const id = Number(quality.id);
    // Preserve the existing cap's exclusion of HDR/Dolby profiles, whose names imply no pixel limit.
    return id !== 125 && id !== 126 && bilibiliResolution(id) <= bilibiliResolution(ceiling);
  });
}

/** Exact manual choice first; otherwise resolution, with source order for peer variants. */
export function selectBilibiliQuality(ids: number[], requested: number) {
  if (ids.includes(requested)) return requested;
  const eligible = ids.filter(id => bilibiliResolution(id) <= bilibiliResolution(requested));
  const resolution = eligible.length ? Math.max(...eligible.map(bilibiliResolution)) : Math.min(...ids.map(bilibiliResolution));
  return ids.find(id => bilibiliResolution(id) === resolution)!;
}
