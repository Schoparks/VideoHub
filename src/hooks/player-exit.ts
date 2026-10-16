import { activeFocusScope, focusElement } from '../input/focus';

interface ExitOptions {
  isLeaving: () => boolean;
  start: () => void;
  stop: () => void;
  reveal: () => void;
  flush: () => Promise<void>;
  restore: () => Promise<void>;
  close: () => void;
}

/** Keep return feedback and focus while the existing save/restore sequence completes. */
export function createPlayerExit(options: ExitOptions) {
  return async () => {
    if (options.isLeaving()) return;
    const scope = activeFocusScope();
    options.start();
    options.stop();
    options.reveal();
    requestAnimationFrame(() => {
      if (options.isLeaving() && scope === activeFocusScope()) {
        focusElement(scope.querySelector<HTMLElement>('[data-player-leave]'), false);
      }
    });
    await options.flush();
    await options.restore();
    options.close();
  };
}
