import type { ReactNode } from 'react';
import './library-button.css';

interface Props {
  busy: boolean;
  blocked?: boolean;
  className?: string;
  children: ReactNode;
  action: () => void;
}

/** Import and scan actions stay focusable while a library operation is pending. */
export function LibraryButton({ busy, blocked, className, children, action }: Props) {
  return (
    <button type="button" className={`library-button ${className || ''}`} disabled={blocked}
      aria-disabled={busy || undefined} data-focus-retain={busy || undefined}
      onClick={() => { if (!busy && !blocked) action(); }}>
      <span className="library-button-content">{children}</span>
    </button>
  );
}
