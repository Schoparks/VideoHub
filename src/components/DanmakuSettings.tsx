import { useId } from 'react';
import type { Preferences } from '../shared/types';

export function DanmakuSettings({ value, change }: { value: Preferences; change: (value: Preferences) => void }) {
  const opacityId = useId();
  return (
    <>
      <label className="setting-row">
        <span><b>显示 B 站视频弹幕</b></span>
        <input type="checkbox" role="switch" aria-label="显示 B 站视频弹幕" checked={value.danmaku}
          onChange={event => change({ ...value, danmaku: event.target.checked })} />
      </label>
      <label className="setting-row setting-range" htmlFor={opacityId}>
        <span><b>不透明度</b></span>
        <input id={opacityId} type="range" aria-label="弹幕不透明度" min={.2} max={1} step={.05}
          disabled={!value.danmaku} value={value.danmakuOpacity}
          aria-valuetext={`${Math.round(value.danmakuOpacity * 100)}%`}
          onChange={event => change({ ...value, danmakuOpacity: Number(event.target.value) })} />
        <output className="setting-value" htmlFor={opacityId}>{Math.round(value.danmakuOpacity * 100)}%</output>
      </label>
      <label className="setting-row">
        <span><b>字号</b></span>
        <select aria-label="弹幕字号" disabled={!value.danmaku} value={value.danmakuFontSize}
          onChange={event => change({ ...value, danmakuFontSize: Number(event.target.value) })}>
          {[18, 25, 32, 40].map(size => <option key={size} value={size}>{size} 像素</option>)}
        </select>
      </label>
      <label className="setting-row">
        <span><b>显示区域</b></span>
        <select aria-label="弹幕显示区域" disabled={!value.danmaku} value={value.danmakuArea}
          onChange={event => change({ ...value, danmakuArea: Number(event.target.value) })}>
          <option value={.25}>顶部四分之一</option>
          <option value={.5}>顶部一半</option>
          <option value={1}>全屏</option>
        </select>
      </label>
    </>
  );
}
