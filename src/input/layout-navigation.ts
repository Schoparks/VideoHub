import type { Direction } from './geometry';
import { browseLayoutNavigation } from './browse-hierarchy';
import { settingsNavigation } from './settings-navigation';
export type { Direction } from './geometry';

/** Layout-owned routes take precedence over distance between control centers. */
export function layoutNavigation(active: HTMLElement, elements: HTMLElement[], direction: Direction) {
  const settings = settingsNavigation(active, elements, direction);
  if (settings) return settings;
  const horizontal = direction === 'left' || direction === 'right';
  const step = direction === 'left' || direction === 'up' ? -1 : 1;
  const browse = browseLayoutNavigation(active, elements, direction);
  if (browse) return browse;
  if (horizontal && active.matches('.media-card, .dynamic-entry')) {
    const grid = active.closest('.media-grid');
    if (grid) {
      const cards = elements.filter(node => node.matches('.media-card, .dynamic-entry')
        && node.closest('.media-grid') === grid);
      return cards[cards.indexOf(active) + step] || active;
    }
  }
  const buttons = active.closest('.player-buttons');
  if (buttons) {
    if (horizontal) {
      const row = elements.filter(node => buttons.contains(node));
      return row[row.indexOf(active) + step] || active;
    }
    if (direction === 'up') {
      const timeline = buttons.closest('.player-bottom')?.querySelector<HTMLElement>('.timeline');
      if (timeline && elements.includes(timeline)) return timeline;
    }
  }
  if (!horizontal && active.closest('.setting-row')) {
    const settings = active.closest('.settings');
    if (settings) {
      const rows = elements.filter(node => settings.contains(node) && node.closest('.setting-row'));
      const target = rows[rows.indexOf(active) + step];
      if (target) return target;
    }
  }
  return undefined;
}
