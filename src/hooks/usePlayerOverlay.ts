import { useEffect, useRef, useState, type FocusEvent, type MouseEvent, type RefObject } from 'react';
import { activeFocusScope, focusElement } from '../input/focus';
import { scheduleFocusReturn } from '../input/focus-return';

interface Options {
  bar: RefObject<HTMLDivElement | null>;
  paused: boolean;
  seeking: boolean;
  error: boolean;
  panel: boolean;
  switching: boolean;
  blocked: boolean;
}

export function usePlayerOverlay(options: Options) {
  const [controls, setControls] = useState(true);
  const [reading, setReading] = useState(false);
  const [pointerControls, setPointerControls] = useState(false);
  const [activity, setActivity] = useState(0);
  const lastMove = useRef(0);
  const reveal = (focus = false, targets: readonly string[] = ['[data-focus-default]']) => {
    setControls(true);
    setActivity(value => value + 1);
    if (focus) scheduleFocusReturn(activeFocusScope(), () => {
      const target = targets.map(selector => options.bar.current?.querySelector<HTMLElement>(selector)).find(Boolean);
      focusElement(target, false);
    });
  };
  const hide = () => {
    setControls(false);
    setReading(false);
    setPointerControls(false);
  };
  useEffect(() => {
    const release = () => setPointerControls(false);
    const visibility = () => {
      if (document.hidden) release();
    };
    document.addEventListener('hub-input-action', release);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', release, true);
    window.addEventListener('blur', release);
    return () => {
      document.removeEventListener('hub-input-action', release);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', release, true);
      window.removeEventListener('blur', release);
    };
  }, []);
  useEffect(() => {
    if (!controls || options.paused || options.seeking || options.error || options.panel
      || options.switching || options.blocked || reading || pointerControls) return;
    const timeout = setTimeout(hide, 5000);
    return () => clearTimeout(timeout);
  }, [controls, options.paused, options.seeking, options.error, options.panel, options.switching, options.blocked,
    reading, pointerControls, activity]);
  return {
    controls, reveal, hide,
    pointerMove: (event: MouseEvent<HTMLElement>) => {
      const target = event.target;
      setPointerControls(target instanceof Element && !!target.closest('.player-bottom, .player-overlay header'));
      if (Date.now() - lastMove.current > 200) {
        lastMove.current = Date.now();
        reveal();
      }
    },
    pointerLeave: () => setPointerControls(false),
    focus: (event: FocusEvent<HTMLElement>) => {
      setReading(event.target.hasAttribute('data-scroll-content'));
      reveal();
    },
    blur: (event: FocusEvent<HTMLElement>) => {
      if (event.target.hasAttribute('data-scroll-content')) setReading(false);
    },
  };
}
