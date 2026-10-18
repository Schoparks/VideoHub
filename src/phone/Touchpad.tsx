import { useEffect, useRef } from 'react';
import type { ControllerAction } from '../shared/remote-control';
import { usePointerClickGuard } from './usePointerClickGuard';

export function Touchpad({ send }: { send: (action: ControllerAction) => void }) {
  const clickGuard = usePointerClickGuard(() => send('confirm'));
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean } | undefined>(undefined);
  useEffect(() => {
    const cancel = () => { gesture.current = undefined; };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', cancel); };
  }, []);
  return <button type="button" className="touchpad" aria-label="滑动移动，轻点确认"
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      clickGuard.pointerDown();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    }}
    onPointerMove={event => {
      const point = gesture.current;
      if (!point || point.id !== event.pointerId) return;
      const x = event.clientX - point.x, y = event.clientY - point.y;
      if (Math.max(Math.abs(x), Math.abs(y)) < 32) return;
      point.moved = true;
      point.x = event.clientX;
      point.y = event.clientY;
      send(Math.abs(x) > Math.abs(y) ? x > 0 ? 'right' : 'left' : y > 0 ? 'down' : 'up');
    }}
    onPointerUp={event => {
      if (gesture.current?.id !== event.pointerId) return;
      if (!gesture.current.moved) send('confirm');
      gesture.current = undefined;
    }}
    onPointerCancel={() => { gesture.current = undefined; }}
    onLostPointerCapture={() => { gesture.current = undefined; }}
    onKeyDown={clickGuard.keyDown} onClick={clickGuard.click}>
    <span>滑动移动 · 轻点确认</span>
  </button>;
}
