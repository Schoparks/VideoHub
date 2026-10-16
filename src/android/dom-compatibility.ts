import ResizeObserverPolyfill from 'resize-observer-polyfill';
import 'wicg-inert';
import './legacy-focus.css';
import './legacy-layout.css';

if (typeof window.ResizeObserver !== 'function') window.ResizeObserver = ResizeObserverPolyfill;

if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function (...nodes: (Node | string)[]) {
    this.textContent = '';
    this.append(...nodes);
  };
}

// Selectors and flex gaps are independent of JavaScript transpilation.
if (!CSS.supports('selector(:is(*))')) document.documentElement.dataset.legacyWebview = 'true';
