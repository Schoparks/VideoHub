import { activeFocusScope, focusables, focusElement } from './focus';
import { browseNavigationRows, parentNavigation, selectedNavigation } from './browse-hierarchy';

/** Return and shoulder actions share the same nearest-to-outermost navigation levels. */
export function browseNavigationAction(action: 'back' | 'previous' | 'next') {
  if (activeFocusScope() !== document) return false;
  const active = document.activeElement as HTMLElement;
  const rows = browseNavigationRows(focusables());
  const level = rows.findIndex(row => row.includes(active));
  if (action === 'back') {
    const target = parentNavigation(active, rows);
    if (!target) return false;
    focusElement(target);
    return true;
  }
  const step = action === 'previous' ? -1 : 1;
  for (let index = level < 0 ? rows.length - 1 : level; index >= 0; index--) {
    // Shoulder traversal selects tabs/filters, and crosses their edges into the parent row.
    const row = index === 0 ? rows[index] : rows[index].filter(node => node.matches('[aria-pressed]'));
    const current = row.includes(active) ? active : selectedNavigation(row);
    const target = row[row.indexOf(current) + step];
    if (!target || target.getAttribute('aria-disabled') === 'true') continue;
    focusElement(target);
    if (target.matches('[aria-pressed]') && target.closest('[data-browse-nav]')
      || target.matches('.navigation-bar nav .nav-item')) target.click();
    return true;
  }
  return true;
}
