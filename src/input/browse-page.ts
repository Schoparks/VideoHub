import { activeFocusScope, focusables, focusElement } from './focus';

const contentSelector = '.media-card, .queue-title, .dynamic-entry';

/** Move the browse focus with the viewport; leave pagination and source ordering alone. */
export function moveBrowsePage(main: HTMLElement | null, direction: -1 | 1) {
  if (!main || main.closest('[inert]') || activeFocusScope() !== document) return;
  const controls = focusables(main).filter(node => !node.matches('.card-details'));
  const items = controls.filter(node => node.matches(contentSelector));
  if (!items.length) return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const viewport = main.getBoundingClientRect();
  const origin = focused && main.contains(focused) ? focused.getBoundingClientRect() : null;
  const originTop = origin?.top ?? viewport.top + main.clientHeight / 2;
  const originX = origin ? origin.left + origin.width / 2 : viewport.left;
  const step = Math.max(1, main.clientHeight * .85);
  const targetTop = originTop + direction * step;
  const candidates = items.map(node => ({ node, rect: node.getBoundingClientRect() }))
    .filter(({ rect }) => (rect.top - originTop) * direction > 3);
  if (!candidates.length) {
    if (direction > 0) return;
    const first = items[0];
    const headers = controls.filter(node => !node.matches(contentSelector)
      && !!(node.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING));
    const relevant = headers.filter(node => node.matches('.tabs button, .chips button, .section-heading button'));
    const target = [...relevant].reverse().find(node => node.getAttribute('aria-pressed') === 'true')
      || relevant.at(-1) || headers.at(-1) || first;
    main.scrollTop = 0;
    focusElement(target);
    return;
  }
  const score = (rect: DOMRect) => Math.abs(rect.top - targetTop) * 4
    + Math.abs(rect.left + rect.width / 2 - originX);
  const target = candidates.reduce((best, next) => score(next.rect) < score(best.rect) ? next : best);
  main.scrollBy({ top: direction * step, behavior: 'instant' });
  focusElement(target.node);
}
