import { glassDisplacement } from './glass-displacement';

const namespace = 'http://www.w3.org/2000/svg';
const surfaces = [
  '.navigation-bar nav', '.navigation-bar > .nav-item', '.global-search',
  '.tv-button', '.modal', '.player-overlay > header', '.player-bottom',
  '.page-actions > button',
  '.episode-panel', '.player-option-panel', '.working-pill',
].join(',');
let sequence = 0;

function svgNode(tag: string, attributes: Record<string, string>) {
  const node = document.createElementNS(namespace, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

/** Visual-only registry: observes surface size, never handles input or application data. */
export function installGlassOptics(svg: SVGSVGElement): () => void {
  if (!CSS.supports('backdrop-filter', 'url("#glass")')) return () => {};
  const registry = new Map<HTMLElement, { filter: Element; size: string; pending?: string }>();
  let frame = 0;
  let settle = 0;
  const updateSurface = (node: HTMLElement, settled: boolean) => {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const width = Math.round(rect.width), height = Math.round(rect.height);
    const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius);
    const size = `${width}:${height}:${radius}`;
    let record = registry.get(node);
    if (record?.size === size) {
      if (record.pending) {
        record.pending = undefined;
        node.style.setProperty('--glass-optics', `url("#${record.filter.id}")`);
      }
      return;
    }
    if (record && !settled) {
      // Keep the CSS glass material during native window animations. Encoding
      // a new displacement texture on every intermediate size stalls resizing.
      node.style.removeProperty('--glass-optics');
      if (record.pending !== size) {
        record.pending = size;
        clearTimeout(settle);
        settle = window.setTimeout(() => refresh(true), 140);
      }
      return;
    }
    if (!record) {
      const filter = svgNode('filter', {
        id: `yingji-glass-${++sequence}`, 'color-interpolation-filters': 'sRGB',
        filterUnits: 'userSpaceOnUse', x: '0', y: '0',
      });
      svg.append(filter);
      record = { filter, size: '' };
      registry.set(node, record);
      observer.observe(node);
    }
    const map = glassDisplacement(width, height, radius);
    if (!map) return;
    record.filter.setAttribute('width', String(width));
    record.filter.setAttribute('height', String(height));
    record.filter.replaceChildren(
      svgNode('feGaussianBlur', {
        in: 'SourceGraphic', result: 'soft',
        stdDeviation: node.matches('.modal, .episode-panel, .player-option-panel') ? '6' : '.65',
      }),
      svgNode('feImage', {
        href: map, x: '0', y: '0', width: String(width), height: String(height),
        preserveAspectRatio: 'none', result: 'rim',
      }),
      svgNode('feDisplacementMap', {
        in: 'soft', in2: 'rim', scale: '28', xChannelSelector: 'R', yChannelSelector: 'G',
      }),
    );
    record.size = size;
    record.pending = undefined;
    node.style.setProperty('--glass-optics', `url("#${record.filter.id}")`);
  };
  const refresh = (settled = false) => {
    for (const [node, record] of registry) {
      if (!node.isConnected) {
        observer.unobserve(node);
        node.style.removeProperty('--glass-optics');
        record.filter.remove();
        registry.delete(node);
      }
    }
    document.querySelectorAll<HTMLElement>(surfaces).forEach(node => updateSurface(node, settled));
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  };
  const observer = new ResizeObserver(schedule);
  const mutations = new MutationObserver(records => {
    if (records.some(record => !svg.contains(record.target))) schedule();
  });
  mutations.observe(document.body, { childList: true, subtree: true });
  refresh();
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(settle);
    observer.disconnect();
    mutations.disconnect();
    for (const [node, record] of registry) {
      node.style.removeProperty('--glass-optics');
      record.filter.remove();
    }
  };
}
