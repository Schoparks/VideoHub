import { useEffect, useRef, type RefObject } from 'react';
import type { PlaybackSource } from '../shared/types';
import { api, message } from '../api';
import { androidDashRange } from '../android/dash-range';
import { dashFailure, nativeMediaFailure } from '../shared/media-failure';
import { dashSettings } from '../shared/dash-settings';

interface Callbacks {
  prepare: (position: number) => boolean | void;
  duration: (value: number) => void;
  position: (value: number) => void;
  paused: (value: boolean) => void;
  loading: (value: boolean) => void;
  error: (text: string) => void;
  sync: (text: string) => void;
  reveal: (focus?: boolean) => void;
  suspend?: () => void;
}

export function usePlayerMedia(source: PlaybackSource, videoRef: RefObject<HTMLVideoElement | null>, volume: number, rate: number, callbacks: Callbacks) {
  const effectiveRate = source.live ? 1 : rate;
  const active = useRef(source), events = useRef(callbacks);
  const output = useRef({ volume, rate: effectiveRate });
  active.current = source;
  events.current = callbacks;
  output.current = { volume, rate: effectiveRate };
  const loadedSession = useRef<string | undefined>(undefined);
  const intent = useRef({ sessionId: source.sessionId, playing: true, pending: false, failed: false, revision: 0 });
  const lastWarning = useRef(''), resumeAt = useRef(0), previousSession = useRef('');
  const isPaused = () => {
    if (intent.current.failed) return true;
    if (loadedSession.current !== active.current.sessionId || intent.current.pending) return !intent.current.playing;
    return videoRef.current?.paused ?? true;
  };
  const setPlaying = (playing: boolean, reportError = true) => {
    const video = videoRef.current;
    if (!video || intent.current.sessionId !== active.current.sessionId) return;
    const current = intent.current;
    if (playing && current.failed) return;
    current.playing = playing;
    current.pending = false;
    const revision = ++current.revision;
    events.current.paused(!playing);
    if (!playing) {
      video.pause();
      return;
    }
    if (loadedSession.current !== current.sessionId) return;
    current.pending = true;
    void video.play().catch(error => {
      if (active.current.sessionId !== current.sessionId || intent.current !== current
        || current.revision !== revision || !current.playing) return;
      if (!reportError && error instanceof DOMException && error.name === 'NotAllowedError') {
        setPlaying(false);
        events.current.loading(false);
        events.current.reveal(true);
      } else {
        const text = error instanceof DOMException
          ? error.name === 'NotSupportedError' ? '此设备无法播放当前媒体，请重试或更换视频。' : '无法开始播放，请重试。'
          : message(error);
        fail(text);
      }
    }).finally(() => {
      if (current.revision === revision) current.pending = false;
    });
  };
  const flush = async (force = false) => {
    const video = videoRef.current, sessionId = loadedSession.current;
    if (!video || video.readyState === 0 || !sessionId) return;
    try {
      const result = await api.progress(sessionId, video.currentTime || 0, Number.isFinite(video.duration) ? video.duration : 0, force);
      if (sessionId !== active.current.sessionId) return;
      if (result.warning && result.warning !== lastWarning.current) {
        lastWarning.current = result.warning;
        events.current.sync(result.warning);
      }
    } catch {
      if (sessionId === active.current.sessionId) events.current.sync('进度保存失败，请检查存储空间');
    }
  };
  const fail = (text = nativeMediaFailure(videoRef.current?.error?.code,
    active.current.videoCodec, active.current.videoCapabilities)) => {
    if (intent.current.sessionId !== active.current.sessionId || intent.current.failed) return;
    intent.current.failed = true;
    setPlaying(false);
    events.current.loading(false);
    events.current.error(text);
    events.current.reveal();
    void flush(true);
  };
  useEffect(() => {
    const video = videoRef.current!;
    let disposed = false, restored = false, cleanup: (() => void) | undefined;
    const startAt = previousSession.current === source.sessionId ? resumeAt.current : source.startAt;
    previousSession.current = source.sessionId;
    resumeAt.current = startAt;
    loadedSession.current = undefined;
    lastWarning.current = '';
    const autoPlay = events.current.prepare(startAt) !== false;
    intent.current = { sessionId: source.sessionId, playing: autoPlay, pending: false, failed: false, revision: 0 };
    events.current.paused(!autoPlay);
    // Start explicitly after position/output restoration, using the latest user intent.
    video.autoplay = false;
    const failSession = (text?: string) => { if (!disposed) fail(text); };
    const metadata = () => {
      if (disposed || active.current.sessionId !== source.sessionId || intent.current.failed) return;
      const length = Number.isFinite(video.duration) ? video.duration : 0;
      loadedSession.current = source.sessionId;
      events.current.duration(length);
      if (restored) return;
      restored = true;
      const resumePosition = resumeAt.current;
      if (resumePosition > 0 && !source.live) video.currentTime = length
        ? Math.min(resumePosition, Math.max(0, length - .1)) : resumePosition;
      video.volume = output.current.volume;
      video.playbackRate = output.current.rate;
      if (!intent.current.playing) {
        video.pause();
        events.current.paused(true);
        events.current.loading(false);
        return;
      }
      setPlaying(true, false);
    };
    const ready = () => {
      if (disposed || active.current.sessionId !== source.sessionId || intent.current.failed
        || loadedSession.current !== source.sessionId
        || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
      events.current.loading(false);
    };
    video.addEventListener('loadedmetadata', metadata);
    video.addEventListener('canplay', ready);
    const setup = async () => {
      if (source.format === 'hls') {
        const { default: Hls } = await import('hls.js');
        if (disposed) return;
        if (!Hls.isSupported()) {
          video.src = source.url;
          return;
        }
        const hls = new Hls({ maxBufferLength: 30, liveSyncDurationCount: 3 });
        hls.loadSource(source.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) failSession('直播或 HLS 视频流中断，请重试'); });
        cleanup = () => hls.destroy();
      } else if (source.format === 'dash') {
        const dash = await import('dashjs');
        if (disposed) return;
        const player = dash.MediaPlayer().create();
        if (window.hubPlatform === 'android') player.addRequestInterceptor(androidDashRange);
        player.updateSettings(dashSettings(source.item.source === 'url', window.hubPlatform === 'android'));
        player.initialize(video, source.url, false);
        player.on('error', event => failSession(dashFailure(event)));
        cleanup = () => player.reset();
      } else if (source.format === 'flv') {
        const { default: mpegts } = await import('mpegts.js');
        if (disposed) return;
        if (!mpegts.isSupported()) {
          failSession('此设备不支持 FLV 播放');
          return;
        }
        const player = mpegts.createPlayer({ type: 'flv', isLive: source.live, url: source.url });
        player.attachMediaElement(video);
        player.load();
        player.on(mpegts.Events.ERROR, () => failSession('FLV 视频流中断，请重试'));
        cleanup = () => player.destroy();
      } else video.src = source.url;
    };
    void setup().catch(() => failSession());
    const timer = setInterval(() => { void flush(); }, 5000);
    return () => {
      disposed = true;
      intent.current.playing = false;
      intent.current.revision++;
      clearInterval(timer);
      video.removeEventListener('loadedmetadata', metadata);
      video.removeEventListener('canplay', ready);
      const position = video.currentTime, duration = Number.isFinite(video.duration) ? video.duration : 0;
      const save = loadedSession.current === source.sessionId && video.readyState > 0
        ? api.progress(source.sessionId, position, duration, true) : Promise.resolve();
      loadedSession.current = undefined;
      void save.catch(() => {}).finally(() => {
        if (active.current.sessionId !== source.sessionId) void api.release(source.sessionId).catch(() => {});
      });
      cleanup?.();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [source.sessionId]);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.playbackRate = effectiveRate;
    }
  }, [volume, effectiveRate, source.sessionId]);
  useEffect(() => api.onSuspend?.(() => {
    events.current.suspend?.();
    setPlaying(false);
    void flush(true);
    events.current.reveal();
  }), [source.sessionId]);
  const rememberPosition = (position: number) => {
    resumeAt.current = position;
    events.current.position(position);
  };
  return {
    flush,
    isPaused,
    playbackRevision: () => intent.current.revision,
    setPlaying,
    fail,
    failed: () => intent.current.failed,
    playing: () => {
      if (!intent.current.failed && intent.current.playing && intent.current.sessionId === active.current.sessionId) return true;
      setPlaying(false);
      return false;
    },
    rememberPosition,
    timeUpdate: (position: number) => {
      if (loadedSession.current) rememberPosition(position);
    },
  };
}
