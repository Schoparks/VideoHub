import type { Preferences } from '../shared/types';

export function PlaybackSettings({ value, change }: { value: Preferences; change: (value: Preferences) => void }) {
  return (
    <>
      <label className="setting-row">
        <span><b>播完后</b></span>
        <select aria-label="播完后" value={value.autoNext ? 'next' : 'pause'}
          onChange={event => change({ ...value, autoNext: event.target.value === 'next' })}>
          <option value="next">自动连播</option>
          <option value="pause">播完暂停</option>
        </select>
      </label>
      <label className="setting-row">
        <span><b>默认播放速度</b></span>
        <select aria-label="默认播放速度" value={value.playbackRate}
          onChange={event => change({ ...value, playbackRate: Number(event.target.value) })}>
          {[.5, .75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </label>
    </>
  );
}
