import { useEffect, useRef, type CSSProperties } from 'react';
import { time } from '../api';

interface Props {
  position: number;
  duration: number;
  seek?: number;
  blocked: boolean;
  preview: (position: number) => void;
  commit: (position: number) => void;
  cancel: () => void;
}

export function PlayerTimeline({ position, duration, seek, blocked, preview, commit, cancel }: Props) {
  const draft = useRef<number | undefined>(seek);
  const pointer = useRef<number | undefined>(undefined);
  const interrupted = useRef(false);
  useEffect(() => {
    if (seek === undefined && draft.current !== undefined && pointer.current !== undefined) {
      interrupted.current = true;
      pointer.current = undefined;
    }
    draft.current = seek;
  }, [seek]);
  const discard = () => {
    if (pointer.current !== undefined) interrupted.current = true;
    draft.current = undefined;
    pointer.current = undefined;
    cancel();
  };
  const finish = (pointerId: number) => {
    if (pointer.current !== pointerId) return;
    const value = draft.current;
    draft.current = undefined;
    pointer.current = undefined;
    if (!blocked && !interrupted.current && value !== undefined) commit(value);
  };
  const cancelPointer = (pointerId: number) => {
    if (pointer.current === pointerId) discard();
  };
  useEffect(() => {
    // Native range thumbs own dragging; listen for releases beyond the input.
    const release = (event: PointerEvent) => {
      finish(event.pointerId);
    };
    const canceled = (event: PointerEvent) => {
      cancelPointer(event.pointerId);
    };
    const deactivate = () => {
      if (pointer.current !== undefined) discard();
    };
    const visibility = () => {
      if (document.hidden) deactivate();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', canceled);
    window.addEventListener('blur', deactivate);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', canceled);
      window.removeEventListener('blur', deactivate);
      document.removeEventListener('visibilitychange', visibility);
    };
  });
  const progress = duration > 0 ? Math.min(100, Math.max(0, (seek ?? position) / duration * 100)) : 0;
  const style = { '--timeline-progress': `${progress}%` } as CSSProperties;
  return (
    <input className="timeline" type="range" aria-label="播放进度"
      style={style}
      aria-valuetext={`${time(seek ?? position)} / ${time(duration)}`}
      aria-disabled={blocked || undefined} data-focus-retain={blocked || undefined}
      disabled={duration <= 0} min={0} max={duration || 1} step={1} value={seek ?? position}
      onChange={event => {
        if (blocked || interrupted.current) return;
        draft.current = Number(event.target.value);
        preview(draft.current);
      }}
      onPointerDown={event => {
        if (!blocked) {
          interrupted.current = false;
          pointer.current = event.pointerId;
        }
      }}
      onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
          interrupted.current = false;
        }
      }}
      onPointerUp={event => finish(event.pointerId)}
      onPointerCancel={event => cancelPointer(event.pointerId)}
      onBlur={discard} />
  );
}
