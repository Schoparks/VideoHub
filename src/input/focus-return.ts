import { activeFocusScope, ensureFocus, focusables, focusElement } from './focus';

/** Restore after inert is removed, unless newer input or a scope change supersedes it. */
export function scheduleFocusReturn(scope: ParentNode, restore: (scope: ParentNode) => void) {
  const clear = () => {
    document.removeEventListener('hub-input-action', cancel);
    window.removeEventListener('keydown', cancel, true);
    window.removeEventListener('pointerdown', cancel, true);
  };
  const cancel = () => {
    cancelAnimationFrame(frame);
    clear();
  };
  const frame = requestAnimationFrame(() => {
    clear();
    if (activeFocusScope() !== scope) return;
    if (scope instanceof HTMLElement && scope.matches('.player:not(.controls-visible)')) return;
    restore(scope);
  });
  document.addEventListener('hub-input-action', cancel);
  window.addEventListener('keydown', cancel, true);
  window.addEventListener('pointerdown', cancel, true);
}

/** Capture stable neighbours before an overlay can remove or replace its opener. */
export function rememberFocusReturn(opener = document.activeElement as HTMLElement | null, scroll = false) {
  const owner = opener?.closest('.media-card-wrap, .queue-row');
  const primary = owner?.querySelector<HTMLElement>('.media-card, .queue-title');
  const group = owner?.parentElement;
  const items = group ? Array.from(group.querySelectorAll<HTMLElement>('.media-card, .queue-title')) : [];
  const index = primary ? items.indexOf(primary) : -1;
  const neighbours = index >= 0 ? items.slice(index + 1).concat(items.slice(0, index).reverse()) : [];
  const candidates = [opener, primary, ...neighbours].map(element => ({ element, key: element?.dataset.focusKey }));
  return (scope: ParentNode) => {
    const available = focusables(scope);
    const nodes = new Set(available);
    const identities = new Map<string, HTMLElement>();
    for (const element of available) {
      const key = element.dataset.focusKey;
      if (key && !identities.has(key)) identities.set(key, element);
    }
    let target: HTMLElement | undefined;
    for (const { element, key } of candidates) {
      target = element && nodes.has(element) ? element : key ? identities.get(key) : undefined;
      if (target) break;
    }
    if (target) focusElement(target, scroll);
    else ensureFocus(scope);
  };
}
