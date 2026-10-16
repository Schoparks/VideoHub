import { nearest } from './geometry';
import type { Direction } from './geometry';

export const browseNavigationSelector = '[data-browse-nav]';
const contentSelector = '.media-card, .queue-title, .dynamic-entry';

/** Navigation levels are explicit; unrelated page actions never become a parent row. */
export function browseNavigationRows(elements: HTMLElement[]) {
  const header = document.querySelector('.topbar');
  const primary = elements.filter(node => !!node.closest('.navigation-bar'));
  const tools = elements.filter(node => header?.contains(node) && !node.closest('.navigation-bar'));
  const rows = [primary.concat(tools)];
  for (const group of document.querySelectorAll(browseNavigationSelector)) {
    const row = elements.filter(node => node.closest(browseNavigationSelector) === group);
    if (row.length) rows.push(row);
  }
  return rows.filter(row => row.length);
}

export function selectedNavigation(row: HTMLElement[]) {
  return row.find(node => node.matches('[aria-current="page"]'))
    || row.find(node => node.matches('[aria-pressed="true"]') && node.closest(browseNavigationSelector))
    || row[0];
}

export function parentNavigation(active: HTMLElement, rows: HTMLElement[][]) {
  const level = rows.findIndex(row => row.includes(active));
  return level === 0 ? undefined : selectedNavigation(rows[level < 0 ? rows.length - 1 : level - 1] || []);
}

/** Keep upward browsing in the scrollable content until its top has been reached. */
export function browseLayoutNavigation(active: HTMLElement, elements: HTMLElement[], direction: Direction) {
  if (active.closest('[role="dialog"], [data-focus-scope], .player')) return undefined;
  const rows = browseNavigationRows(elements);
  const level = rows.findIndex(row => row.includes(active));
  if (direction === 'left' || direction === 'right') {
    if (level < 0) return undefined;
    const row = rows[level];
    return row[row.indexOf(active) + (direction === 'left' ? -1 : 1)] || active;
  }
  const main = document.querySelector<HTMLElement>('main');
  if (!main || (!main.contains(active) && level !== 0)) return undefined;
  if (direction === 'up' && main.contains(active) && main.scrollTop > 1) {
    const above = elements.filter(node => main.contains(node) && !node.matches('.card-details'));
    const target = nearest(active.getBoundingClientRect(), above.map(node => node.getBoundingClientRect()), 'up');
    if (target >= 0) return above[target];
    main.scrollTop = 0;
    return active;
  }
  if (level >= 0) {
    if (direction === 'up') return parentNavigation(active, rows) || active;
    if (rows[level + 1]) return selectedNavigation(rows[level + 1]);
    const content = elements.filter(node => main.contains(node) && !node.closest(browseNavigationSelector)
      && !node.closest('.page-actions') && !node.matches('.card-details'));
    return content.find(node => node.matches(contentSelector)) || content[0] || active;
  }
  if (direction === 'up') {
    const content = elements.filter(node => main.contains(node) && !node.closest(browseNavigationSelector)
      && !node.closest('.page-actions') && !node.matches('.card-details'));
    const target = nearest(active.getBoundingClientRect(), content.map(node => node.getBoundingClientRect()), 'up');
    if (target >= 0) return content[target];
    return parentNavigation(active, rows) || active;
  }
  return undefined;
}
