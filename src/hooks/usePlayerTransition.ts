import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { message } from '../api';
import type { PlaybackSource } from '../shared/types';

export interface QualityReturn { item: string; part?: string; paused: boolean }
interface MediaControls {
  flush: (force?: boolean) => Promise<void>;
  isPaused: () => boolean;
  playbackRevision: () => number;
  setPlaying: (playing: boolean) => void;
  canResume: () => boolean;
}
interface Callbacks {
  cancelPending: () => void;
  notify: (text: string) => void;
}

/** Serial source changes and interruption boundaries, independent of media engines. */
export function usePlayerTransition(source: PlaybackSource, callbacks: Callbacks, covered: boolean) {
  const active = useRef(source), events = useRef(callbacks);
  active.current = source;
  events.current = callbacks;
  const generation = useRef(0), busy = useRef(false), leaving = useRef(false);
  const view = useRef(0), overlay = useRef(covered);
  overlay.current = covered;
  useLayoutEffect(() => { view.current++; }, [covered]);
  const qualityReturn = useRef<QualityReturn | undefined>(undefined);
  const [switching, setSwitching] = useState(false);
  const [exiting, setExiting] = useState(false);
  const current = (token: number) => !leaving.current && token === generation.current;
  const cancel = () => {
    generation.current++;
    busy.current = false;
    qualityReturn.current = undefined;
    setSwitching(false);
    events.current.cancelPending();
  };
  useEffect(() => {
    leaving.current = false;
    return () => {
      generation.current++;
      leaving.current = true;
    };
  }, []);
  const run = async (media: MediaControls, action: () => void | Promise<void>, pause = false, returning?: QualityReturn) => {
    if (busy.current || leaving.current) return;
    const token = ++generation.current;
    const sessionId = active.current.sessionId;
    busy.current = true;
    qualityReturn.current = returning;
    setSwitching(true);
    const resume = pause && !media.isPaused();
    if (pause) media.setPlaying(false);
    const playbackRevision = media.playbackRevision();
    try {
      await media.flush(true);
      if (!current(token)) return;
      await action();
    } catch (error) {
      if (current(token)) events.current.notify(message(error));
    } finally {
      if (current(token)) {
        busy.current = false;
        setSwitching(false);
        // Only a failed change may resume the still-current original session.
        if (resume) requestAnimationFrame(() => {
          if (current(token) && active.current.sessionId === sessionId && media.canResume()
            && media.playbackRevision() === playbackRevision) media.setPlaying(true);
        });
      }
    }
  };
  return {
    switching, exiting, run, cancel,
    blocked: () => busy.current || leaving.current,
    isLeaving: () => leaving.current,
    leave: () => { leaving.current = true; setExiting(true); cancel(); },
    checkpoint: () => ({ generation: generation.current, sessionId: active.current.sessionId, view: view.current }),
    sameView: (token: { sessionId: string; view: number }) => !leaving.current
      && token.sessionId === active.current.sessionId && token.view === view.current && !overlay.current,
    valid: (token: { generation: number; sessionId: string; view: number }) => current(token.generation)
      && token.sessionId === active.current.sessionId && token.view === view.current && !overlay.current,
    prepare: (next: PlaybackSource) => {
      const returning = qualityReturn.current;
      qualityReturn.current = undefined;
      const preserve = returning?.item === next.item.id && returning?.part === next.part?.id;
      return { preserve, playing: !preserve || !returning?.paused };
    },
  };
}
