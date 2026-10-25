import { useEffect, useRef, useState } from 'react';
import type { CompanionCard, CompanionPlayer, CompanionSettings, PlayerCommand } from '../shared/companion';
import type { ControllerCommand, ControllerReply } from '../shared/remote-control';
import { connectionError } from './connection';
import { PhoneMediaList } from './PhoneMediaList';
import { PhoneCover } from './PhoneCover';
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Square, Ellipsis, MessageSquare, RotateCw } from 'lucide-react';
import { PhonePlayerOptions } from './PhonePlayerOptions';
import { usePhoneMediaActions } from './PhoneMediaActions';
import './phone-player.css';

function time(seconds: number) {
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
export function PhonePlayer({ player, current, preferences, send, play, playing }: {
  current?: CompanionCard; preferences: CompanionSettings;
  player?: CompanionPlayer; send: (command: ControllerCommand) => Promise<ControllerReply>;
  play: (item: CompanionCard) => void; playing: boolean;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [related, setRelated] = useState<CompanionCard[]>([]), [relatedError, setRelatedError] = useState('');
  const [reading, setReading] = useState(false), [seek, setSeek] = useState<number>();
  const pending = useRef(false), revision = useRef(0);
  const session = player?.session;
  const actions = usePhoneMediaActions();
  const readRelated = async () => {
    if (!session || !player?.related) return;
    const token = revision.current;
    setReading(true);
    try {
      const reply = await send({ kind: 'related', session });
      if (revision.current === token) { setRelated(reply.catalog?.items || []); setRelatedError(''); }
    } catch (failure) { if (revision.current === token) setRelatedError(connectionError(failure)); }
    finally { if (revision.current === token) setReading(false); }
  };
  useEffect(() => {
    revision.current++;
    setRelated([]); setRelatedError(''); setSeek(undefined); setError(''); setBusy(false);
    void readRelated();
    return () => { revision.current++; };
  }, [session]);
  const control = async (command: PlayerCommand) => {
    if (!session || pending.current) return false;
    const token = revision.current;
    pending.current = true; setBusy(true);
    try { await send({ kind: 'player', session, command }); if (token === revision.current) setError(''); return true; }
    catch (failure) { if (token === revision.current) setError(connectionError(failure)); return false; }
    finally { pending.current = false; if (token === revision.current) setBusy(false); }
  };
  if (!player) return <section><h2>正在播放</h2><p className="phone-empty">电视尚未播放视频</p></section>;
  const disabled = busy || playing || player.busy;
  const toggleDanmaku = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    const token = revision.current;
    try { await send({ kind: 'settings', patch: { danmaku: !preferences.danmaku } }); }
    catch (failure) { if (token === revision.current) setError(connectionError(failure)); }
    finally { pending.current = false; if (token === revision.current) setBusy(false); }
  };
  return <section className="phone-player" aria-label="正在播放">
    <div className="phone-now-cover">{current && <PhoneCover item={current} />}</div>
    <div className="phone-now-heading"><div>
    <p className="phone-eyebrow">{player.error ? '播放失败' : player.loading ? '正在缓冲' : player.ended ? '已播完' : player.paused ? '已暂停' : '正在电视上播放'}</p>
    <h2>{player.title}</h2>
    {current?.author && <p className="phone-author">{current.author}</p>}
    </div>{current && <button aria-label="当前视频操作" disabled={disabled}
      onClick={event => actions({ item: current }, event.currentTarget)}><Ellipsis size={23} /></button>}</div>
    {(error || player.error) && <p className="form-error" role="alert">{error || player.error}</p>}
    {!player.live && <div className="phone-progress">
      <input type="range" aria-label="播放进度" min={0} max={player.duration || 1} step={1}
        value={seek ?? player.position} disabled={disabled || !player.duration || player.loading || !!player.error}
        onChange={event => setSeek(Number(event.target.value))} />
      <div><span>{time(seek ?? player.position)}</span><span>{time(player.duration)}</span></div>
      {seek !== undefined && <div className="phone-player-buttons">
        <button disabled={disabled} onClick={() => { void control({ operation: 'seek', value: seek }); setSeek(undefined); }}>跳转到此处</button>
        <button onClick={() => setSeek(undefined)}>取消</button>
      </div>}
    </div>}
    <div className="phone-transport">
      <button aria-label="后退10秒" disabled={disabled || player.live || !player.duration || !!player.error}
        onClick={() => void control({ operation: 'seek', value: Math.max(0, player.position - 10) })}><RotateCcw size={23} /><small>10</small></button>
      <button aria-label="上一项 / 重播" disabled={disabled || player.live || !!player.error} onClick={() => void control({ operation: 'previous' })}><SkipBack size={26} /></button>
      <button className="phone-play-toggle" disabled={disabled} aria-label={player.error ? '重试' : player.ended ? '重新播放' : player.paused ? '继续播放' : '暂停'}
        onClick={() => void control({ operation: player.error ? 'retry' : 'toggle' })}>
        {player.error || player.ended ? <RotateCcw size={30} /> : player.paused ? <Play size={32} fill="currentColor" /> : <Pause size={32} fill="currentColor" />}</button>
      <button aria-label="下一项" disabled={disabled || !player.next || !!player.error} onClick={() => void control({ operation: 'next' })}><SkipForward size={26} /></button>
      <button aria-label="前进10秒" disabled={disabled || player.live || !player.duration || !!player.error}
        onClick={() => void control({ operation: 'seek', value: Math.min(player.duration, player.position + 10) })}><RotateCw size={23} /><small>10</small></button>
    </div>
    <PhonePlayerOptions key={session} player={player} disabled={disabled} control={control} error={error} />
    <div className="phone-player-secondary">
      {current?.source === 'bilibili' && !player.live && <button aria-label="显示弹幕" aria-pressed={preferences.danmaku}
        disabled={disabled} onClick={() => void toggleDanmaku()}><MessageSquare size={21} /></button>}
      <button aria-label="结束播放" disabled={disabled} onClick={() => void control({ operation: 'stop' })}><Square size={19} /></button>
    </div>
    {player.related && <section className="phone-related" aria-label="B 站相关推荐"><h3>B 站相关推荐</h3>
      {reading && <p role="status">正在加载…</p>}
      {relatedError && <p className="form-error" role="alert">{relatedError} <button disabled={reading} onClick={() => void readRelated()}>重试</button></p>}
      {!reading && !relatedError && !related.length && <p className="phone-empty">暂无相关推荐</p>}
      <PhoneMediaList items={related} play={play} busy={disabled} />
    </section>}
  </section>;
}

