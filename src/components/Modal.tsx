import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { activeFocusScope, ensureFocus, focusables, focusElement } from '../input/gamepad';
import { rememberFocusReturn, scheduleFocusReturn } from '../input/focus-return';
interface ModalProps {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}

export function Modal({ title, children, close, wide = false }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Capture before children with autoFocus mount, so dismissal returns to the opener.
  const returnFocus = useRef(rememberFocusReturn());
  const returnScope = useRef(activeFocusScope());
  useLayoutEffect(() => {
    const node = ref.current!;
    const parents = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(el => el !== node);
    const previousInert = parents.map(el => el.inert);
    parents.forEach(el => { el.inert = true; });
    ensureFocus(node);
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const elements = focusables(node);
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) {
        e.preventDefault();
        return;
      }
      if (!elements.includes(document.activeElement as HTMLElement)) {
        e.preventDefault();
        focusElement(e.shiftKey ? last : first);
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        focusElement(last);
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        focusElement(first);
      }
    };
    node.addEventListener('keydown',trap);
    return () => {
      parents.forEach((el, index) => { el.inert = previousInert[index]; });
      node.removeEventListener('keydown',trap);
      scheduleFocusReturn(returnScope.current, scope => {
        if (node.isConnected) return;
        returnFocus.current(scope);
      });
    };
  }, []);
  return (
    <div
      className="modal-scrim"
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`modal ${wide ? 'wide' : ''}`}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="关闭弹窗">
            <X size={22} />
          </button>
        </header>
        {children}
        <footer className="modal-input-hints" data-input-hints-host />
      </div>
    </div>
  );
}
