import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MediaPart, PlaybackSource, Preferences, PlaybackOpenResult } from '../shared/types';
import type { Action } from '../input/gamepad';
import { playerAction } from '../input/player-actions';
import { EpisodePicker } from './EpisodePicker';
import { PlayerControls } from './PlayerControls';
import { PlayerFeedback } from './PlayerFeedback';
import { usePlayerMedia } from '../hooks/usePlayerMedia';
import { usePlayerWindow } from '../hooks/usePlayerWindow';
import { useDanmaku } from '../hooks/useDanmaku';
import { DanmakuLayer } from './DanmakuLayer';
import { usePlayerOverlay } from '../hooks/usePlayerOverlay';
import { usePlayerTransition, type QualityReturn } from '../hooks/usePlayerTransition';
import { PlayerOptionPicker } from './PlayerOptionPicker';
import { usePlayerCompletion } from '../hooks/usePlayerCompletion';
import { createPlayerExit } from '../hooks/player-exit';
import './player-updates.css';
import type { NextPlaybackKind } from '../shared/playback-next';
import { allowedBilibiliQualities } from '../shared/bilibili-quality';
import { PlayerVideo } from './PlayerVideo';
import { playerCompanion, companionTransition, type CompanionPlayerHandle } from '../hooks/player-companion';

export interface PlayerHandle extends CompanionPlayerHandle { action(action: Action): boolean }
interface PlayerProps {
  source: PlaybackSource;
  preferences: Preferences;
  blocked: boolean;
  close: () => void;
  cancelPending: () => void;
  settings: () => void;
  toggleDanmaku: () => void;
  next: () => Promise<PlaybackOpenResult>;
  nextKind: NextPlaybackKind | undefined;
  queue: () => void;
  episode: (part: MediaPart) => Promise<'opened' | 'failed' | 'canceled' | 'busy'>;
  quality: (value: number, position: number, same?: boolean) => Promise<'opened' | 'failed' | 'canceled' | 'busy'>;
  reload: (position: number) => Promise<PlaybackOpenResult>;
  notify: (message: string) => void;
}

export const Player = forwardRef<PlayerHandle, PlayerProps>(function Player({ source, preferences, blocked, close, cancelPending, settings, toggleDanmaku, next, nextKind, queue, episode, quality, reload, notify }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const episodeOpener = useRef<HTMLElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seek, setSeek] = useState<number>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState(preferences.playbackRate);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [choice, setChoice] = useState<'rate' | 'quality'>();
  const choiceOpener = useRef<HTMLElement | null>(null);
  const [sync, setSync] = useState('');
  const playerWindow = usePlayerWindow(preferences.tvMode, notify);
  const { fullscreen } = playerWindow;
  const danmaku = useDanmaku(source, preferences.danmaku);
  const operations = usePlayerTransition(source, { cancelPending, notify }, blocked || episodesOpen || !!choice);
  const { switching, exiting } = operations;
  const parts = source.parts || (source.part ? [source.part] : []);
  const qualities = source.item.source === 'bilibili' && !source.live
    ? allowedBilibiliQualities(source.qualities || [], preferences) : source.qualities || [];
  const partIndex = parts.findIndex(part => part.id === source.part?.id);
  const overlay = usePlayerOverlay({ bar: barRef, paused, seeking: seek !== undefined, error: !!error,
    panel: episodesOpen || !!choice, switching: switching || playerWindow.busy || exiting, blocked });
  const { controls, reveal } = overlay;
  const editing = blocked || episodesOpen || !!choice || seek !== undefined;
  const media = usePlayerMedia(source, videoRef, 1, rate, {
    prepare: start => {
      setError('');
      setEnded(false);
      setSync('');
      setLoading(true);
      setSeek(undefined);
      setPosition(start);
      setDuration(0);
      setEpisodesOpen(false);
      setChoice(undefined);
      const { preserve, playing } = operations.prepare(source);
      reveal(!preserve);
      return playing;
    },
    duration: setDuration, position: setPosition, paused: setPaused, loading: setLoading,
    error: text => { if (!operations.isLeaving()) setError(text); }, sync: setSync, reveal,
    suspend: () => { completion.cancel(); operations.cancel(); },
  });
  const { flush } = media;
  const toggle = () => {
    if (operations.blocked()) return;
    const video = videoRef.current;
    if (!video) return;
    if (ended) {
      setSeek(undefined);
      completion.restart();
      video.currentTime = 0;
      media.rememberPosition(0);
      setEnded(false);
    }
    media.setPlaying(media.isPaused());
    reveal();
  };
  const leave = createPlayerExit({
    isLeaving: operations.isLeaving,
    start: () => {
      completion.cancel();
      operations.leave();
    },
    stop: () => media.setPlaying(false),
    reveal,
    flush: () => flush(true),
    restore: playerWindow.restore,
    close,
  });
  const openQueue = async () => {
    if (operations.blocked()) return;
    const token = operations.checkpoint();
    reveal();
    await flush(true);
    if (operations.valid(token)) queue();
  };
  const transition = async (run: () => void | Promise<void>, pause = false, returning?: QualityReturn) => {
    completion.cancel();
    await operations.run({ ...media, canResume: () => !completion.completed() }, run, pause, returning);
  };
  const advance = (pause = false) => {
    if (nextKind && !operations.blocked()) void transition(async () => { await next(); }, pause);
  };
  const completion = usePlayerCompletion({ sessionId: source.sessionId, autoNext: preferences.autoNext,
    covered: editing, switching, error: !!error, advance: () => advance() });
  const chooseEpisode = (part: MediaPart) => {
    setEpisodesOpen(false);
    reveal();
    if (part.id !== source.part?.id) void transition(async () => { await episode(part); }, true);
    else if (ended) toggle();
  };
  const closeEpisodes = () => {
    setEpisodesOpen(false);
    reveal();
  };
  const showEpisodes = () => {
    if (operations.blocked()) return;
    const focused = document.activeElement;
    episodeOpener.current = focused instanceof HTMLElement && focused.closest('.player') && !focused.closest('[inert]')
      ? focused : barRef.current?.querySelector('.episode-toggle') || null;
    setSeek(undefined);
    reveal();
    setEpisodesOpen(true);
  };
  const previous = () => {
    if (source.live || operations.blocked()) return;
    if (partIndex > 0) {
      void transition(async () => { await episode(parts[partIndex - 1]); }, true);
      return;
    }
    const video = videoRef.current;
    if (video) {
      setSeek(undefined);
      completion.restart();
      video.currentTime = 0;
      setEnded(false);
      media.rememberPosition(0);
      media.setPlaying(true);
      void flush(true);
      reveal();
    }
  };
  const commitSeek = (value = seek) => {
    if (operations.blocked() || error) return;
    const video = videoRef.current;
    if (value === undefined || !video) return;
    video.currentTime = value;
    if (value < duration) {
      completion.restart();
      setEnded(false);
    }
    media.rememberPosition(value);
    setSeek(undefined);
    void flush(true);
    reveal();
  };
  const closeOptions = () => { setChoice(undefined); reveal(); };
  const openOptions = (kind: 'rate' | 'quality', opener: HTMLElement) => {
    if (operations.blocked() || kind === 'quality' && !qualities.length) return;
    choiceOpener.current = opener;
    setSeek(undefined);
    reveal();
    setChoice(kind);
  };
  const chooseOption = (value: number) => {
    if (operations.blocked()) return;
    closeOptions();
    if (choice === 'rate') setRate(value);
    else if (choice === 'quality' && !error && value === source.quality) void quality(value, position, true);
    else if (choice === 'quality' && (error || value !== source.quality)) {
      const current = videoRef.current;
      const start = current?.readyState ? current.currentTime : position;
      void transition(async () => { await quality(value, start); }, true,
        { item: source.item.id, part: source.part?.id, paused: !error && media.isPaused() });
    }
  };
  useImperativeHandle(ref, () => ({
    ...playerCompanion({
      state: { session: source.sessionId, title: source.item.title, live: source.live,
        paused, ended, busy: switching || exiting, loading, error, position, duration, rate: source.live ? 1 : rate,
        quality: source.quality, qualities, parts: parts.map(({ id, title }) => ({ id, title })),
        part: source.part?.id, next: !!nextKind, related: source.item.source === 'bilibili' && source.item.kind === 'video' },
      blocked: () => blocked || episodesOpen || !!choice || seek !== undefined || operations.blocked(),
      toggle, previous, next: () => companionTransition(run => transition(run, true), next), stop: leave, seek: commitSeek, rate: setRate,
      retry: () => companionTransition(run => transition(run), () => reload(videoRef.current?.currentTime || position)),
      transition: run => {
        const checkpoint = operations.checkpoint();
        return transition(async () => { if (operations.sameView(checkpoint)) await run(); }, true);
      },
      episode: async id => {
        if (id === source.part?.id) { if (ended) toggle(); return {}; }
        return companionTransition(run => transition(run, true), () => episode(parts.find(part => part.id === id)!));
      },
      quality: async value => {
        const start = videoRef.current?.readyState ? videoRef.current.currentTime : position;
        return companionTransition(run => transition(run, true,
          { item: source.item.id, part: source.part?.id, paused: !error && media.isPaused() }),
        () => quality(value, start, !error && value === source.quality));
      },
    }),
    action: action => playerAction(action, {
      controls, error: !!error, switching, exiting, episodes: episodesOpen, options: !!choice,
      seeking: seek !== undefined, multipart: parts.length > 1,
      onTimeline: document.activeElement?.getAttribute('aria-label') === '播放进度',
      closeEpisodes, closeOptions, hideControls: overlay.hide,
      cancelSeek: () => setSeek(undefined), leave: () => void leave(), toggle,
      next: () => advance(true), previous, queue: () => void openQueue(), showEpisodes,
      settings: () => reveal(true, ['[aria-label="清晰度"]', '[aria-label="播放速度"]', '[aria-label="播放设置"]']),
      preview: offset => {
        if (source.live || duration <= 0) return;
        reveal(!controls, ['.timeline', '[data-focus-default]']);
        setSeek(Math.max(0, Math.min(duration, (seek ?? videoRef.current?.currentTime ?? 0) + offset)));
      },
      commitSeek, reveal,
    }),
  }));
  useEffect(() => {
    if (error) {
      completion.cancel();
      setChoice(undefined);
      setEpisodesOpen(false);
      setSeek(undefined);
    }
  }, [error]);
  return (
    <section className={`player ${controls && !error ? 'controls-visible' : ''}`} inert={blocked}
      data-live={source.live} data-paused={paused} data-seeking={seek !== undefined}
      data-ended={ended} data-switching={switching}
      data-error={!!error}
      data-exiting={exiting}
      data-multipart={parts.length > 1} aria-label="视频播放器"
      onMouseMove={overlay.pointerMove} onMouseLeave={overlay.pointerLeave}
      onFocusCapture={overlay.focus} onBlurCapture={overlay.blur}>
      <PlayerVideo key={source.sessionId} session={source.sessionId} videoRef={videoRef} media={media}
        completion={completion} leaving={operations.isLeaving} blocked={operations.blocked} editing={editing}
        toggle={toggle} reveal={reveal} duration={setDuration} loading={setLoading} paused={setPaused} ended={setEnded} />
      {preferences.danmaku && danmaku.available && <DanmakuLayer key={`danmaku:${source.sessionId}`} comments={danmaku.comments} preferences={preferences} video={videoRef} />}
      <PlayerFeedback loading={loading && !exiting} error={error} busy={switching} exiting={exiting} covered={!!choice} seek={seek}
        quality={qualities.length ? opener => openOptions('quality', opener) : undefined}
        retry={() => void transition(async () => { await reload(videoRef.current?.readyState ? videoRef.current.currentTime : position); })}
        leave={() => void leave()} />
      <PlayerControls
        source={source} qualityAvailable={!!qualities.length} parts={parts} partIndex={partIndex} paused={paused} position={position}
        ended={ended} loading={loading} exiting={exiting}
        duration={duration} controls={controls && !error} episodesOpen={episodesOpen} optionsOpen={!!choice} switching={switching}
        seek={seek} rate={rate} fullscreen={fullscreen} fullscreenBusy={playerWindow.busy} sync={sync || danmaku.error}
        danmakuAvailable={danmaku.available} danmakuEnabled={preferences.danmaku}
        toggleDanmaku={() => { if (!operations.isLeaving()) toggleDanmaku(); }}
        settings={() => { if (!operations.isLeaving()) settings(); }}
        autoNext={preferences.autoNext} barRef={barRef} leave={() => void leave()} toggle={toggle}
        previous={previous} next={() => advance(true)} nextKind={nextKind}
        preview={value => {
          if (operations.blocked() || error) return;
          setSeek(value);
          reveal();
        }} commit={commitSeek} cancelSeek={() => setSeek(undefined)}
        options={openOptions}
        episodes={showEpisodes} queue={() => void openQueue()}
        toggleFullscreen={() => { if (!operations.isLeaving()) void playerWindow.toggle(); }} />
      {episodesOpen && <EpisodePicker parts={parts} current={source.part} ended={ended} autoNext={preferences.autoNext}
        switching={switching} opener={episodeOpener.current} choose={chooseEpisode} close={closeEpisodes} />}
      {choice && <PlayerOptionPicker title={choice === 'rate' ? '播放速度' : '清晰度'}
        value={choice === 'rate' ? rate : source.quality} opener={choiceOpener.current}
        options={choice === 'rate' ? [.5, .75, 1, 1.25, 1.5, 2].map(id => ({ id, label: `${id}×` })) : qualities}
        choose={chooseOption} close={closeOptions} />}
    </section>
  );
});
