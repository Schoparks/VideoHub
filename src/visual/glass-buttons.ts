const targets = [
  '.page-actions > button', '.detail-actions > button', '.button-row > button',
  '.modal button.primary', '.modal-header > button.icon-button', '.settings-tabs > button',
  '.settings .bindings button', '.navigation-bar > .nav-item', '.navigation-bar nav > .nav-item',
  '.tv-button', '.player-buttons > button', '.player-overlay > header > button',
  '.player-option-panel header > button', '.episode-panel header > button',
  '.player-option-panel .player-option', '.episode-panel .episode-option',
].join(',');

/** Visual registration and light feedback only; activation and focus stay with existing controls. */
export function installGlassButtons(): () => void {
  const root = document.getElementById('root') || document.body;
  const marked = new Set<HTMLButtonElement>();
  let active: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointer: number | undefined;
  const clear = () => {
    clearTimeout(timer);
    if (active) {
      delete active.dataset.glassPressed;
      active.style.removeProperty('--glass-press-x');
      active.style.removeProperty('--glass-press-y');
    }
    active = undefined;
    pointer = undefined;
  };
  const mark = (node: HTMLButtonElement) => {
    node.dataset.glassButton = node.matches('.player-option, .episode-option') ? 'list'
      : node.closest('.navigation-bar nav, .settings-tabs') ? 'segment'
      : node.closest('.player-buttons, .player-overlay > header') ? 'playback'
        : node.closest('.modal, .player-option-panel, .episode-panel, .player-error') ? 'inset' : 'regular';
    marked.add(node);
  };
  const visit = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLButtonElement && node.matches(targets)) mark(node);
    node.querySelectorAll<HTMLButtonElement>(targets).forEach(mark);
  };
  const observer = new MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(visit);
    for (const node of marked) {
      if (!node.isConnected) {
        if (node === active) clear();
        delete node.dataset.glassButton;
        marked.delete(node);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  visit(root);
  const target = (event: Event) => {
    const node = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-glass-button]') : null;
    return node && !node.disabled && node.getAttribute('aria-disabled') !== 'true' ? node : undefined;
  };
  const light = (node: HTMLButtonElement, event?: PointerEvent) => {
    clear();
    active = node;
    if (event) {
      const rect = node.getBoundingClientRect();
      const percentage = (position: number, origin: number, length: number) =>
        `${Math.max(0, Math.min(100, (position - origin) / Math.max(1, length) * 100))}%`;
      node.style.setProperty('--glass-press-x', percentage(event.clientX, rect.left, rect.width));
      node.style.setProperty('--glass-press-y', percentage(event.clientY, rect.top, rect.height));
      pointer = event.pointerId;
    }
    node.dataset.glassPressed = 'true';
    // A missing release must never retain a bright/pressed surface indefinitely.
    timer = setTimeout(clear, 1000);
  };
  const down = (event: PointerEvent) => {
    const node = target(event);
    if (node && event.button === 0) light(node, event);
  };
  const up = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    clearTimeout(timer);
    pointer = undefined;
    timer = setTimeout(clear, 140);
  };
  const cancel = (event: PointerEvent) => { if (event.pointerId === pointer) clear(); };
  const click = (event: MouseEvent) => {
    const node = target(event);
    if (!node || node === active) return;
    light(node);
    clearTimeout(timer);
    timer = setTimeout(clear, 140);
  };
  const hidden = () => { if (document.hidden) clear(); };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('click', click, true);
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('blur', clear);
  return () => {
    observer.disconnect();
    clear();
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', cancel, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('blur', clear);
    for (const node of marked) delete node.dataset.glassButton;
  };
}
