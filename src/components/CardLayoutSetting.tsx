import type { Preferences } from '../shared/types';

export function CardLayoutSetting({ value, change }: { value: Preferences; change: (value: Preferences) => void }) {
  return (
    <label className="setting-row">
      <span><b>卡片大小</b></span>
      <select aria-label="卡片大小" value={value.cardColumns || 0}
        onChange={event => change({ ...value, cardColumns: Number(event.target.value) })}>
        <option value={0}>自动</option>
        <option value={2}>超大 · 每行 2 个</option>
        <option value={3}>大 · 每行 3 个</option>
        <option value={4}>中 · 每行 4 个</option>
        <option value={5}>小 · 每行 5 个</option>
        <option value={6}>紧凑 · 每行 6 个</option>
      </select>
    </label>
  );
}
