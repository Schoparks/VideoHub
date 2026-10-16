import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { api, message } from '../api';
import type { MediaItem, MediaPart, PlaybackSource } from '../shared/types';
import type { Dialog } from '../navigation';
import { ensureFocus } from '../input/focus';
import { rememberFocusReturn, scheduleFocusReturn } from '../input/focus-return';
import { nextPlaybackTarget } from '../shared/playback-next';
import { withKnownPlaybackParts } from '../shared/playback-parts';

interface PlaybackOptions {
  dialog: Dialog;
  closeDialog: () => void;
  queue: MediaItem[];
  bootstrap: () => Promise<void>;
  notify: (message: string) => void;
  focusedCard: RefObject<HTMLElement | null>;
}

export function usePlayback(options: PlaybackOptions) {
  const { dialog, closeDialog, queue, bootstrap, notify, focusedCard } = options;
  const [source, setSource] = useState<PlaybackSource>();
  const [opening, setOpening] = useState(false);
  const playbackRequest = useRef(0);
  const playPending = useRef(false);
  const sourceRef = useRef(source);
  const returnFocus = useRef<(scope: ParentNode) => void>(undefined);
  sourceRef.current = source;
  const dialogVersion = useRef(0);
  const activeDialog = useRef(dialog);
  useLayoutEffect(() => {
    activeDialog.current = dialog;
    dialogVersion.current++;
  }, [dialog]);

  const restoreFocus = (token: number) => {
    const restore = returnFocus.current;
    returnFocus.current = undefined;
    scheduleFocusReturn(document, scope => {
      if (token !== playbackRequest.current || sourceRef.current) return;
      if (restore) restore(scope);
      else ensureFocus(scope);
    });
  };
  const cancelPending = () => {
    if (playPending.current) void api.cancelUrlResolution?.().catch(() => {});
    playbackRequest.current++;
    playPending.current = false;
    setOpening(false);
  };
  const cancelOpening = () => {
    if (!playPending.current || sourceRef.current) return false;
    cancelPending();
    closeDialog();
    restoreFocus(playbackRequest.current);
    return true;
  };
  const interruption = useRef({ cancelOpening, cancelPending });
  interruption.current = { cancelOpening, cancelPending };
  useEffect(() => api.onSuspend?.(() => {
    if (!interruption.current.cancelOpening()) interruption.current.cancelPending();
  }), []);

  const play = async (
    input: MediaItem | (() => Promise<MediaItem>),
    part?: MediaPart,
    quality?: number,
    position?: number,
    failure?: (message: string) => void,
  ) => {
    if (playPending.current) return;
    if (!sourceRef.current) {
      const opener = dialog === 'details' ? focusedCard.current : document.activeElement as HTMLElement;
      returnFocus.current = rememberFocusReturn(opener, true);
    }
    playPending.current = true;
    const initiatingDialog = dialogVersion.current;
    const token = ++playbackRequest.current;
    setOpening(true);
    try {
      const item = typeof input === 'function' ? await input() : input;
      if (token !== playbackRequest.current) return;
      const resolved = await api.resolve(item, part, quality);
      if (token !== playbackRequest.current) {
        await api.release(resolved.sessionId);
        return;
      }
      const playback = withKnownPlaybackParts(resolved, sourceRef.current);
      if (position !== undefined) playback.startAt = position;
      sourceRef.current = playback;
      setSource(playback);
      if (dialog && activeDialog.current === dialog && initiatingDialog === dialogVersion.current) closeDialog();
    } catch (error) {
      if (token === playbackRequest.current) (failure || notify)(message(error));
    } finally {
      if (token === playbackRequest.current) {
        playPending.current = false;
        setOpening(false);
      }
    }
  };

  const closePlayer = async () => {
    cancelPending();
    const token = playbackRequest.current;
    const previous = sourceRef.current;
    sourceRef.current = undefined;
    setSource(undefined);
    restoreFocus(token);
    if (previous) {
      try { await api.release(previous.sessionId); }
      catch (error) { notify(message(error)); }
    }
    await bootstrap();
  };

  const next = async () => {
    if (!source) return;
    const token = playbackRequest.current;
    let target = nextPlaybackTarget(source, queue);
    if (target?.kind === 'unknown') {
      try {
        const parts = (await api.detail(source.item)).parts;
        if (token !== playbackRequest.current || sourceRef.current?.sessionId !== source.sessionId) return;
        const knownSource = { ...sourceRef.current, parts };
        sourceRef.current = knownSource;
        setSource(knownSource);
        target = nextPlaybackTarget(knownSource, queue);
      } catch (error) {
        if (token === playbackRequest.current) notify(message(error));
        return;
      }
    }
    if (target?.kind === 'episode') {
      await play(source.item, target.part, source.quality, 0);
      return;
    }
    if (target?.kind === 'queue') {
      await play(target.item);
      return;
    }
    notify('已经是最后一项');
  };

  return {
    source, opening, setOpening, play, closePlayer, next, cancelOpening, cancelPending,
    nextKind: nextPlaybackTarget(source, queue)?.kind,
    canCancelOpening: opening && playPending.current && !source,
  };
}
