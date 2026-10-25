import { useRef, useState } from 'react';
import type { CompanionSettings } from '../shared/companion';
import type { ControllerCommand, ControllerReply } from '../shared/remote-control';
import { bilibiliQualityLimits } from '../shared/bilibili-quality';
import { connectionError, forgetConnection } from './connection';
import './phone-settings.css';

export function PhoneSettings({ value, send }: {
  value: CompanionSettings; send: (command: ControllerCommand) => Promise<ControllerReply>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [panel, setPanel] = useState<'watch' | 'danmaku' | 'interface'>('watch');
  const pending = useRef(false);
  const change = async (patch: Partial<CompanionSettings>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await send({ kind: 'settings', patch }); setError(''); }
    catch (failure) { setError(connectionError(failure)); }
    finally { pending.current = false; setBusy(false); }
  };
  const toggle = (key: 'autoNext' | 'syncHistory' | 'danmaku' | 'tvMode', label: string) =>
    <label className="phone-field">{label}<input type="checkbox" role="switch" checked={value[key]}
      onChange={event => void change({ [key]: event.target.checked })} /></label>;
  const select = (key: keyof CompanionSettings, label: string, options: { value: string | number; label: string }[]) =>
    <label className="phone-field">{label}<select aria-label={label} value={String(value[key])} onChange={event => void change({
      [key]: typeof value[key] === 'number' ? Number(event.target.value) : event.target.value,
    })}>{!options.some(option => String(option.value) === String(value[key])) && <option value={String(value[key])}>{String(value[key])}</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  return <section className="phone-settings" aria-label="电视设置">
    <nav className="phone-setting-tabs" aria-label="设置分类">
      {([{ id: 'watch', label: '观看' }, { id: 'danmaku', label: '弹幕' }, { id: 'interface', label: '界面' }] as const).map(item =>
        <button key={item.id} aria-pressed={panel === item.id} onClick={() => setPanel(item.id)}>{item.label}</button>)}
    </nav>
    <fieldset disabled={busy} className="phone-setting-fields" aria-label={{ watch: '观看', danmaku: '弹幕', interface: '界面' }[panel]}>
      {panel === 'watch' && <>
      {toggle('autoNext', '自动连播')}
      {toggle('syncHistory', '同步 B 站进度')}
      {select('playbackRate', '默认倍速', [.5, .75, 1, 1.25, 1.5, 2].map(rate => ({ value: rate, label: `${rate}×` })))}
      {select('bilibiliMaxQuality', 'B 站画质上限', bilibiliQualityLimits.map(item => ({ value: item.id, label: item.label })))}
      {select('bilibiliQualityMode', '画质选择', [{ value: 'highest', label: '自动选择' }, { value: 'remember', label: '记住手动选择' }])}
      </>}
      {panel === 'danmaku' && <>
      {toggle('danmaku', '显示弹幕')}
      {select('danmakuOpacity', '不透明度', [.2, .4, .6, .8, 1].map(value => ({ value, label: `${value * 100}%` })))}
      {select('danmakuFontSize', '字号', [18, 20, 25, 30, 35, 40].map(value => ({ value, label: String(value) })))}
      {select('danmakuArea', '显示区域', [{ value: .25, label: '四分之一' }, { value: .5, label: '半屏' }, { value: 1, label: '全屏' }])}
      </>}
      {panel === 'interface' && <>
      {toggle('tvMode', '电视字号')}
      {select('theme', '主题', [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }])}
      {select('cardColumns', '每行卡片', [0, 2, 3, 4, 5, 6].map(value => ({ value, label: value ? `${value} 个` : '自动' })))}
      <div className="phone-field"><span>手机连接</span><button className="phone-forget" onClick={() => { forgetConnection(); location.reload(); }}>忘记此连接</button></div>
      </>}
    </fieldset>
    <div className="phone-setting-feedback" aria-live="polite">
      {error ? <p role="alert" className="form-error">{error}</p> : busy && <p role="status">正在保存…</p>}
    </div>
  </section>;
}

