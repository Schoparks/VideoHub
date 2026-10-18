import type { Direction } from './geometry';

/** Tabs activate on confirmation; movement only changes focus. */
export function settingsNavigation(active: HTMLElement, elements: HTMLElement[], direction: Direction) {
  const settings = active.closest('.settings');
  if (!settings) return undefined;
  const tabs = elements.filter(node => node.closest('.settings-tabs') && settings.contains(node));
  const panel = elements.filter(node => node.closest('.settings-panel') && settings.contains(node));
  if (tabs.includes(active)) {
    if (direction === 'left' || direction === 'right') {
      return tabs[tabs.indexOf(active) + (direction === 'left' ? -1 : 1)] || active;
    }
    if (direction === 'down') return panel[0] || active;
  }
  if (direction === 'up' && panel[0] === active) {
    return tabs.find(node => node.getAttribute('aria-selected') === 'true') || active;
  }
  return undefined;
}
