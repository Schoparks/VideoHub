import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props { title: string; opener: HTMLElement | null; close: () => void; children: ReactNode }

export function PhoneSheet({ title, opener, close, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const resize = () => {
      dialog.style.maxHeight = `${Math.max(160, (viewport?.height || innerHeight) - 24)}px`;
      dialog.style.top = `${(viewport?.offsetTop || 0) + 12}px`;
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog ref={ref} className="phone-sheet" aria-label={title} onCancel={event => { event.preventDefault(); close(); }}>
      <header><h2>{title}</h2><button type="button" className="sheet-close" aria-label="关闭卡片" onClick={close}><X size={22} /></button></header>
      {children}
    </dialog>, document.body,
  );
}
