/** Native select popups do not open from synthetic gamepad clicks. */
export function adjustSelect(element: HTMLSelectElement, direction: number, wrap = false) {
  const options = Array.from(element.options);
  for (let index = element.selectedIndex + direction, attempts = 0; attempts < options.length; index += direction, attempts++) {
    if (index < 0 || index >= options.length) {
      if (!wrap) return;
      index = (index + options.length) % options.length;
    }
    const option = options[index];
    if (option.disabled || option.parentElement?.matches('optgroup:disabled')) continue;
    if (index === element.selectedIndex) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, option.value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
}

export function adjustRange(element: HTMLInputElement, direction: number) {
  // stepUp/stepDown follow the HTML stepping grid, avoiding floating-point drift.
  try {
    if (direction > 0) element.stepUp();
    else element.stepDown();
  } catch { return; }
  const value = element.value;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function scrollContent(element: HTMLElement, direction: number) {
  const maximum = element.scrollHeight - element.clientHeight;
  if (maximum <= 1 || direction < 0 && element.scrollTop <= 0 || direction > 0 && element.scrollTop >= maximum - 1) return false;
  element.scrollBy({ top: direction * Math.max(48, element.clientHeight * .65), behavior: 'instant' });
  return true;
}
