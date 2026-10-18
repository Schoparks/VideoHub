/** Capability-based material selection; no media sampling or application state. */
export function installGlassMaterial(): () => void {
  const html = document.documentElement;
  const native = CSS.supports('backdrop-filter', 'blur(1px)');
  const prefixed = CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  html.dataset.glassMaterial = native ? 'native' : prefixed ? 'prefixed' : 'fallback';
  if (native || prefixed || !CSS.supports('filter', 'blur(1px)')) {
    return () => { delete html.dataset.glassMaterial; };
  }
  const root = document.getElementById('root') || document.body;
  let frame = 0;
  let shell: HTMLElement | null = null;
  const update = () => {
    frame = 0;
    shell = root.querySelector<HTMLElement>('.app-shell');
    // A single inactive browse surface can be softened without touching video or foreground text.
    const blur = shell?.hasAttribute('inert') && !!root.querySelector('.modal-scrim')
      && !root.querySelector('.player');
    if (blur) shell!.dataset.glassBlurred = 'true';
    else if (shell) delete shell.dataset.glassBlurred;
  };
  const observer = new MutationObserver(records => {
    const changed = records.some(record => record.type === 'attributes'
      ? record.target === shell
      : record.target === root || [...record.addedNodes, ...record.removedNodes].some(node =>
        node instanceof Element && (node.matches('.modal-scrim, .player') || node.querySelector('.modal-scrim, .player'))));
    if (changed && !frame) frame = requestAnimationFrame(update);
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
  update();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    if (shell) delete shell.dataset.glassBlurred;
    delete html.dataset.glassMaterial;
  };
}
