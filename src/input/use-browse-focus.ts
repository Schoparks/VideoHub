import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { focusables, focusElement } from './focus';

/** Navigation intent survives asynchronous feed rendering, but never user movement. */
export function useBrowseFocus(view: string, main: RefObject<HTMLElement | null>, blocked: boolean) {
  const pending = useRef<{ view: string } | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    const intent = pending.current;
    const node = main.current;
    if (!intent || !node) return;
    if (blocked || intent.view !== view) {
      pending.current = undefined;
      return;
    }
    let frame = 0;
    const cancel = () => { pending.current = undefined; };
    const settle = () => {
      if (pending.current !== intent || node.closest('[inert]')) return;
      // Effects may replace the previous feed after the route commit.
      if (node.querySelector('.feed-results[aria-busy="true"], .feed-results[data-browse-ready="false"]')) return;
      const controls = focusables(node);
      const target = controls.find(el => el.matches('.media-card, .queue-title, .dynamic-entry'))
        || controls.find(el => el.closest('.feed-results'))
        || controls.find(el => el.matches('.chips [aria-pressed="true"]'))
        || controls.find(el => el.closest('section'))
        || controls.find(el => el.matches('.tabs [aria-pressed="true"]'))
        || controls.find(el => !el.closest('.tabs, .page-actions')) || node;
      pending.current = undefined;
      node.scrollTop = 0;
      focusElement(target);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(settle);
    };
    const action = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      if (value === 'confirm' && document.activeElement?.getAttribute('aria-disabled') === 'true') return;
      cancel();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (['Enter', ' '].includes(event.key) && document.activeElement?.getAttribute('aria-disabled') === 'true') return;
      cancel();
    };
    const observer = new MutationObserver(schedule);
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'data-browse-ready'] });
    document.addEventListener('hub-input-action', action);
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('keydown', keyboard, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('hub-input-action', action);
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('keydown', keyboard, true);
    };
  }, [view, blocked, main, revision]);
  return (nextView: string) => {
    pending.current = { view: nextView };
    setRevision(value => value + 1);
  };
}
