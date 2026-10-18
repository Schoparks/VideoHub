import { useEffect, useRef, type ReactNode } from 'react';
import type { ControllerAction } from '../shared/remote-control';
import { usePointerClickGuard } from './usePointerClickGuard';

interface Props {
  action: ControllerAction;
  label: string;
  children?: ReactNode;
  className?: string;
  repeat?: boolean;
  send: (action: ControllerAction) => void;
}

export function ControlButton({ action, label, children, className, repeat, send }: Props) {
  const clickGuard = usePointerClickGuard(() => send(action));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointer = useRef<{ id: number; x: number; y: number; repeated: boolean } | undefined>(undefined);
  const stop = () => { clearTimeout(timer.current); pointer.current = undefined; };
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => { stop(); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  const start = () => {
    if (!repeat) return;
    const began = Date.now();
    const tick = () => {
      if (pointer.current === undefined || Date.now() - began > 8000) { stop(); return; }
      pointer.current.repeated = true;
      send(action);
      timer.current = setTimeout(tick, 140);
    };
    timer.current = setTimeout(tick, 420);
  };
  return <button type="button" className={className} aria-label={label}
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      clickGuard.pointerDown();
      event.preventDefault();
      stop();
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, repeated: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      start();
    }}
    onPointerMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const held = pointer.current;
      if (held && (Math.hypot(event.clientX - held.x, event.clientY - held.y) > 10
        || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) stop();
    }}
    onPointerUp={event => {
      const held = pointer.current;
      if (held?.id === event.pointerId && !held.repeated) send(action);
      stop();
    }} onPointerCancel={stop} onLostPointerCapture={stop}
    onKeyDown={clickGuard.keyDown} onClick={clickGuard.click}>
    {children || label}
  </button>;
}
