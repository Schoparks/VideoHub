import type { Preferences } from '../shared/types';
import { CardLayoutSetting } from './CardLayoutSetting';
import { PlaybackSettings } from './PlaybackSettings';
import { BilibiliQualitySettings } from './BilibiliQualitySettings';

interface Props {
  value: Preferences;
  change: (value: Preferences) => void;
}

export function ViewingSettings({ value, change }: Props) {
  return (
    <>
      <label className="setting-row">
        <span><b>电视模式</b><small>放大界面</small></span>
        <input type="checkbox" role="switch" aria-label="电视模式" checked={value.tvMode}
          onChange={event => change({ ...value, tvMode: event.target.checked })} />
      </label>
      <label className="setting-row">
        <span><b>深色外观</b></span>
        <input type="checkbox" role="switch" aria-label="深色外观" checked={value.theme === 'dark'}
          onChange={event => change({ ...value, theme: event.target.checked ? 'dark' : 'light' })} />
      </label>
      <CardLayoutSetting value={value} change={change} />
      <PlaybackSettings value={value} change={change} />
      <BilibiliQualitySettings value={value} change={change} />
      <label className="setting-row">
        <span><b>同步 B 站播放历史</b><small>同步至 B 站，本机进度始终保留</small></span>
        <input type="checkbox" role="switch" aria-label="同步 B 站播放历史" checked={value.syncHistory}
          onChange={event => change({ ...value, syncHistory: event.target.checked })} />
      </label>
    </>
  );
}
