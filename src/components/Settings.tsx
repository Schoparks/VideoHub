import { Monitor } from 'lucide-react';
import type { Preferences } from '../shared/types';
import { GamepadSettings } from './GamepadSettings';
import { PlaybackSettings } from './PlaybackSettings';
import { DanmakuSettings } from './DanmakuSettings';
import { CardLayoutSetting } from './CardLayoutSetting';

interface SettingsProps {
  value: Preferences;
  change: (value: Preferences) => void;
  device: string;
}

export function Settings({ value, change, device }: SettingsProps) {
  return (
    <div className="settings">
      <div className="settings-heading"><Monitor size={19} /><h3>观看体验</h3></div>
      {window.hubPlatform !== 'android' && <label className="setting-row">
        <span><b>电视模式</b><small>放大界面并进入全屏</small></span>
        <input
          type="checkbox"
          role="switch"
          aria-label="电视模式"
          checked={value.tvMode}
          onChange={e => change({ ...value, tvMode: e.target.checked })}
        />
      </label>}
      <label className="setting-row">
        <span><b>深色外观</b></span>
        <input
          type="checkbox"
          role="switch"
          aria-label="深色外观"
          checked={value.theme === 'dark'}
          onChange={e => change({ ...value, theme: e.target.checked ? 'dark' : 'light' })}
        />
      </label>
      <CardLayoutSetting value={value} change={change} />
      <PlaybackSettings value={value} change={change} />
      <label className="setting-row">
        <span><b>同步 B 站播放历史</b><small>同步至 B 站，本机进度始终保留</small></span>
        <input
          type="checkbox"
          role="switch"
          aria-label="同步 B 站播放历史"
          checked={value.syncHistory}
          onChange={e => change({ ...value, syncHistory: e.target.checked })}
        />
      </label>

      <DanmakuSettings value={value} change={change} />
      {(window.hubPlatform !== 'android' || !!device) && <GamepadSettings value={value} change={change} device={device} />}
    </div>
  );
}
