import { nearest } from './geometry';
import { layoutNavigation } from './layout-navigation';

export function focusables(scope: ParentNode = document) {
  return Array.from(scope.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')).filter(el =>
    el.tabIndex >= 0 && !el.matches(':disabled, [aria-disabled="true"]:not([data-focus-retain])') && el.getClientRects().length > 0 &&
    !(['gamepad', 'remote'].includes(document.documentElement.dataset.inputMode || '') && el.hasAttribute('data-gamepad-skip')) &&
    !el.closest('[inert], [hidden], [aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden');
}

export function activeFocusScope(): ParentNode {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [data-focus-scope]'));
  return overlays.reverse().find(el => el.getClientRects().length > 0 && !el.closest('[inert], [hidden], [aria-hidden="true"]')) ||
    document.querySelector<HTMLElement>('.player:not([inert])') || document;
}

export function focusElement(element?: HTMLElement | null, scroll = true) {
  if (!element || !element.isConnected || element.matches(':disabled') || element.closest('[inert], [hidden]')) return;
  element.focus({ preventScroll: true });
  if (scroll) element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

function ownerFocus(active: HTMLElement, elements: HTMLElement[]) {
  const owner = active?.hasAttribute('data-gamepad-skip')
    ? active.closest('.media-card-wrap')?.querySelector<HTMLElement>('.media-card')
    : active?.closest('.queue-row')?.querySelector<HTMLElement>('.queue-title');
  return owner && elements.includes(owner) ? owner : undefined;
}

export function ensureFocus(scope: ParentNode = activeFocusScope()) {
  const elements = focusables(scope);
  const active = document.activeElement as HTMLElement;
  if (elements.includes(active)) return active;
  const target = ownerFocus(active, elements) || elements.find(el => el.hasAttribute('data-focus-default'))
    || elements.find(el => el.matches('.nav-item.active')) || elements[0];
  focusElement(target);
  return target;
}

export function moveFocus(direction: 'up' | 'down' | 'left' | 'right') {
  let elements = focusables(activeFocusScope());
  const active = document.activeElement as HTMLElement;
  if (!elements.includes(active)) {
    ensureFocus();
    return;
  }
  // Card details have an explicit X shortcut and remain reachable with Tab.
  // Spatial movement should follow the video grid rather than its corner menus.
  if (active.matches('.media-card')) elements = elements.filter(el => !el.matches('.card-details'));
  const routed = layoutNavigation(active, elements, direction);
  if (routed) {
    focusElement(routed);
    return;
  }
  const target = nearest(active.getBoundingClientRect(), elements.map(el => el.getBoundingClientRect()), direction);
  if (target >= 0) focusElement(elements[target]);
}

export function trapTab(event: KeyboardEvent, scope: ParentNode = activeFocusScope()) {
  if (event.key !== 'Tab' || scope === document) return;
  const elements = focusables(scope);
  const index = elements.indexOf(document.activeElement as HTMLElement);
  if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === elements.length - 1) {
    event.preventDefault();
    focusElement(event.shiftKey ? elements.at(-1) : elements[0]);
  }
}

export class FocusRecovery {
  private scope?: ParentNode;
  private elements: HTMLElement[] = [];
  private active?: HTMLElement;

  remember() {
    const scope = activeFocusScope();
    const active = document.activeElement as HTMLElement;
    const elements = focusables(scope);
    if (!elements.includes(active)) return;
    this.scope = scope;
    this.elements = elements;
    this.active = active;
  }

  repair() {
    const scope = activeFocusScope();
    // A hidden player is intentionally unfocused until its controls are revealed.
    if (scope instanceof HTMLElement && scope.matches('.player:not(.controls-visible)')) return;
    const elements = focusables(scope);
    let active = document.activeElement as HTMLElement;
    if (!elements.includes(active)) {
      const lost = active === document.body && scope === this.scope ? this.active : active;
      const oldIndex = this.elements.indexOf(this.active!);
      const survivors = this.elements.slice(Math.max(0, oldIndex)).concat(this.elements.slice(0, Math.max(0, oldIndex)).reverse());
      const candidates = lost?.closest('.queue-row') && !lost.isConnected
        ? survivors.filter(el => el.matches('.queue-title')) : survivors;
      const target = ownerFocus(lost!, elements) || scope === this.scope && candidates.find(el => elements.includes(el));
      if (target) focusElement(target);
      else ensureFocus(scope);
      active = document.activeElement as HTMLElement;
    }
    this.scope = scope;
    this.elements = elements;
    this.active = active;
  }
}
