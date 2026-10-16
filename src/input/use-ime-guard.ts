import { useRef, type KeyboardEvent } from 'react';

export function useImeGuard() {
  const composing = useRef(false), finished = useRef(0);
  const pending = () => composing.current || Date.now() - finished.current < 30;
  return {
    pending,
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: () => { composing.current = false; finished.current = Date.now(); },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && (pending() || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
        event.preventDefault();
      }
    },
  };
}
