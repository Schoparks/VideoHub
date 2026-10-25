import type { Ref } from 'react';
import { Play, Pause, SkipBack, SkipForward, ListVideo, Maximize, Minimize, Layers, MessageSquare, Settings2 } from 'lucide-react';
import type { MediaPart, PlaybackSource } from '../shared/types';
import { time } from '../api';
import { PlayerHeading } from './PlayerHeading';
import { PlayerTimeline } from './PlayerTimeline';
import type { NextPlaybackKind } from '../shared/playback-next';

interface Props {
  source: PlaybackSource;
  qualityAvailable: boolean;
  parts: MediaPart[];
  partIndex: number;
  paused: boolean;
  ended: boolean;
  loading: boolean;
  position: number;
  duration: number;
  controls: boolean;
  episodesOpen: boolean;
  optionsOpen: boolean;
  switching: boolean;
  exiting: boolean;
  seek?: number;
  rate: number;
  fullscreen: boolean;
  fullscreenBusy: boolean;
  sync: string;
  autoNext: boolean;
  danmakuAvailable: boolean;
  danmakuEnabled: boolean;
  toggleDanmaku: () => void;
  settings: () => void;
  barRef: Ref<HTMLDivElement>;
  leave: () => void;
  toggle: () => void;
  previous: () => void;
  next: () => void;
  nextKind: NextPlaybackKind | undefined;
  preview: (position: number) => void;
  commit: (position: number) => void;
  cancelSeek: () => void;
  options: (kind: 'rate' | 'quality', opener: HTMLElement) => void;
  episodes: () => void;
  queue: () => void;
  toggleFullscreen: () => void;
}

export function PlayerControls(props: Props) {
  const { source, parts, partIndex, paused, position, duration, seek, switching } = props;
  const blocked = switching || props.exiting;
  return (
    <div className="player-overlay" inert={props.episodesOpen || props.optionsOpen || !props.controls}>
      <PlayerHeading source={source} parts={parts} partIndex={partIndex} paused={paused}
        ended={props.ended} loading={props.loading} switching={switching} exiting={props.exiting} leave={props.leave} />
      <div className="player-bottom" ref={props.barRef}>
        {source.notice && <p className="playback-notice" role="status">{source.notice}</p>}
        {!source.live && (
          <PlayerTimeline position={position} duration={duration} seek={seek} blocked={blocked}
            preview={props.preview} commit={props.commit} cancel={props.cancelSeek} />
        )}
        <div className="player-buttons">
          <button className="icon-button" data-focus-default onClick={props.toggle}
            aria-disabled={blocked || undefined} data-focus-retain={blocked || undefined}
            aria-label={props.ended ? '重新播放' : paused ? '继续播放' : '暂停'}>
            {paused || props.ended ? <Play fill="currentColor" /> : <Pause fill="currentColor" />}
          </button>
          {!source.live && (
            <button className="icon-button" data-player-action="previous"
              aria-disabled={blocked || undefined} data-focus-retain={blocked || undefined}
              aria-label={partIndex > 0 ? '上一集' : '从头播放'} onClick={props.previous}>
              <SkipBack />
            </button>
          )}
          <button className="icon-button" data-player-action="next" disabled={!props.nextKind}
            aria-disabled={blocked || undefined} data-focus-retain={blocked && !!props.nextKind || undefined}
            aria-label={props.nextKind === 'episode' ? '下一集' : props.nextKind === 'queue' ? '播放队列下一项' : '下一项'} onClick={props.next}>
            <SkipForward />
          </button>
          <span className="timecode">{source.live ? '直播' : `${time(position)} / ${time(duration)}`}</span>
          <div className="player-spacer" />
          {!source.live && (
            <button className="player-choice-button" aria-label="播放速度" aria-haspopup="dialog"
              data-option-value={props.rate}
              data-player-choice="rate" aria-disabled={blocked || undefined} data-focus-retain
              onClick={event => props.options('rate', event.currentTarget)}>{props.rate}×</button>
          )}
          {!!source.qualities?.length && (
            <button className="player-choice-button" aria-label="清晰度" aria-haspopup="dialog"
              disabled={!props.qualityAvailable}
              data-option-value={source.quality}
              data-player-choice="quality" aria-disabled={blocked || undefined} data-focus-retain
              onClick={event => props.options('quality', event.currentTarget)}>
              {source.qualities.find(quality => quality.id === source.quality)?.label || '清晰度'}
            </button>
          )}
          {parts.length > 1 && (
            <button className="episode-toggle" onClick={props.episodes} aria-label={`选集，共 ${parts.length} 集`}
              aria-disabled={blocked || undefined} data-focus-retain={blocked || undefined}>
              <Layers size={18} />选集 <span>{partIndex + 1}/{parts.length}</span>
            </button>
          )}
          <button className="icon-button" aria-label="播放队列" onClick={props.queue}
            aria-disabled={blocked || undefined} data-focus-retain={blocked || undefined}><ListVideo /></button>
          {props.danmakuAvailable && <button className="icon-button" aria-label="显示弹幕"
            data-state-label={props.danmakuEnabled ? '已开启' : '已关闭'}
            aria-disabled={props.exiting || undefined} data-focus-retain={props.exiting || undefined}
            aria-pressed={props.danmakuEnabled} onClick={props.toggleDanmaku}><MessageSquare /></button>}
          <button className="icon-button" aria-label="播放设置" onClick={props.settings}
            aria-disabled={props.exiting || undefined} data-focus-retain={props.exiting || undefined}><Settings2 /></button>
          <button className="icon-button" aria-label={props.fullscreen ? '退出播放器全屏' : '播放器全屏'} onClick={props.toggleFullscreen}
            disabled={window.hubPlatform === 'android'}
            aria-busy={props.fullscreenBusy || undefined} aria-disabled={props.fullscreenBusy || props.exiting || undefined}
            data-focus-retain={props.fullscreenBusy || props.exiting || undefined}>
            {props.fullscreen ? <Minimize /> : <Maximize />}
          </button>
        </div>
        <div className="player-hints">
          <div data-input-hints-host />
          <small>{props.sync || (source.live ? '实时直播' : props.autoNext ? '播完本集自动续播' : '播完本集暂停')}</small>
        </div>
      </div>
    </div>
  );
}
