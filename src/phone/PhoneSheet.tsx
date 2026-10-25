import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X } from 'lucide-react';

interface Props { title: string; opener: HTMLElement | null; close: () => void; children: ReactNode; className?: string; back?: () => void }

export function PhoneSheet({ title, opener, close, children, className = '', back }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const previousTitle = useRef(title);
  useLayoutEffect(() => {
    if (previousTitle.current === title) return;
    previousTitle.current = title;
    ref.current?.scrollTo({ top: 0 });
    ref.current?.querySelector<HTMLButtonElement>('header button')?.focus({ preventScroll: true });
  }, [title]);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const resize = () => {
      const height = viewport?.height || innerHeight;
      dialog.style.maxHeight = `${Math.max(0, height - 24)}px`;
      dialog.style.top = `${(viewport?.offsetTop || 0) + height / 2}px`;
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog ref={ref} className={`phone-sheet ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); (back || close)(); }}>
      <header>{back && <button type="button" className="sheet-back" aria-label="返回工具" onClick={back}><ArrowLeft size={21} /></button>}
        <h2>{title}</h2><button type="button" className="sheet-close" aria-label="关闭卡片" onClick={close}><X size={22} /></button></header>
      {children}
    </dialog>, document.body,
  );
}
