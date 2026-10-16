import { useEffect, useRef, useState } from 'react';
import type { Preferences } from '../shared/types';
import { bindButton } from './bindings';

export function useBindingCapture(value: Preferences, change: (value: Preferences) => void, device: string) {
  const [binding, setBinding] = useState('');
  const [feedback, setFeedback] = useState('');
  const config = useRef({ value, change });
  config.current = { value, change };
  useEffect(() => {
    if (!binding) return;
    let frame = 0, armed = false, candidate: number | undefined, pressedAt = 0;
    const started = performance.now();
    const cancel = (text = '') => {
      setFeedback(text);
      setBinding('');
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    const tick = (now: number) => {
      const pad = Array.from(navigator.getGamepads?.() || []).find(pad => pad?.id === device);
      if (!pad || pad.connected === false) {
        cancel('手柄已断开');
        return;
      }
      if (!document.hasFocus() || now - started > 15000) {
        cancel('按键录入已取消');
        return;
      }
      const keys = pad.buttons.flatMap((button, index) => button.pressed || button.value > .55 ? [index] : []);
      if (!keys.length) armed = true;
      if (armed && keys.length && candidate === undefined) {
        candidate = keys[0];
        pressedAt = now;
      }
      if (candidate !== undefined) {
        if (candidate === config.current.value.gamepadMap.back && keys.includes(candidate) && now - pressedAt >= 700) {
          cancel();
          return;
        }
        if (!keys.length) {
          const next = bindButton(config.current.value.gamepadMap, binding, candidate);
          if (next) {
            config.current.change({ ...config.current.value, gamepadMap: next });
            cancel();
            return;
          }
          setFeedback('方向键用于移动，请选择其他按键');
          candidate = undefined;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener('keydown', keyboard, true);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', keyboard, true);
    };
  }, [binding, device]);
  const begin = (action: string) => {
    if (!Array.from(navigator.getGamepads?.() || []).some(pad => pad && pad.connected !== false)) {
      setFeedback('请先连接手柄');
      return;
    }
    setFeedback('');
    setBinding(current => current === action ? '' : action);
  };
  return { binding, feedback, begin };
}
