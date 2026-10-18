import { useRef, type KeyboardEvent, type MouseEvent } from 'react';

/** Touch browsers may synthesize a zero-detail click after a canceled pointer gesture. */
export function usePointerClickGuard(activate: () => void) {
  const lastPointer = useRef(-Infinity);
  return {
    pointerDown: () => { lastPointer.current = performance.now(); },
    keyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!['Enter', ' '].includes(event.key)) return;
      if (event.repeat) event.preventDefault();
      else lastPointer.current = -Infinity;
    },
    click: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail === 0 && performance.now() - lastPointer.current > 700) activate();
    },
  };
}
