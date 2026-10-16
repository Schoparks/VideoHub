import { useEffect, useRef, useState } from 'react';
import { focusElement } from './focus';

export function useTextEntry(search: () => void) {
  const [entry, setEntry] = useState<HTMLInputElement>();
  const openSearch = useRef(search); openSearch.current = search;
  useEffect(() => {
    const edit = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.hasAttribute('data-gamepad-search')) { openSearch.current(); return; }
      const keyboard = input.closest('.search-dialog')?.querySelector<HTMLButtonElement>('.screen-keyboard [data-keyboard-start]');
      if (keyboard) focusElement(keyboard);
      else setEntry(input);
    };
    document.addEventListener('gamepad-edit', edit);
    return () => document.removeEventListener('gamepad-edit', edit);
  }, []);
  const closeEntry = (value?: string) => {
    if (entry?.isConnected && value !== undefined) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(entry, value);
      entry.dispatchEvent(new Event('input', { bubbles: true }));
      entry.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setEntry(undefined);
  };
  return { entry, closeEntry };
}
