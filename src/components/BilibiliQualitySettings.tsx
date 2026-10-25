import type { Preferences } from '../shared/types';
import { bilibiliQualityLimits, type BilibiliQualityLimit } from '../shared/bilibili-quality';

export function BilibiliQualitySettings({ value, change }: {
  value: Preferences;
  change: (value: Preferences) => void;
}) {
  return (
    <>
      <label className="setting-row">
        <span><b>B 站清晰度上限</b></span>
        <select aria-label="B 站清晰度上限" value={value.bilibiliMaxQuality ?? 0}
          onChange={event => change({ ...value, bilibiliMaxQuality: Number(event.target.value) as BilibiliQualityLimit })}>
          {bilibiliQualityLimits.map(limit => <option key={limit.id} value={limit.id}>{limit.label}</option>)}
        </select>
      </label>
      <label className="setting-row">
        <span><b>B 站清晰度选择</b></span>
        <select aria-label="B 站清晰度选择" value={value.bilibiliQualityMode ?? 'highest'}
          onChange={event => change({ ...value, bilibiliQualityMode: event.target.value as 'highest' | 'remember' })}>
          <option value="highest">按分辨率自动选择</option>
          <option value="remember">记住手动选择</option>
        </select>
      </label>
    </>
  );
}

