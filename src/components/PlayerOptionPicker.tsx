import { useLayoutEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { activeFocusScope, ensureFocus, focusables, focusElement } from '../input/focus';
import { scheduleFocusReturn } from '../input/focus-return';
import './player-options.css';
import './player-menu-scroll.css';
import './player-menu-hints.css';

interface Props {
  title: string;
  value?: number;
  options: { id: number; label: string }[];
  opener: HTMLElement | null;
  choose: (value: number) => void;
  close: () => void;
}

export function PlayerOptionPicker({ title, value, options, opener, choose, close }: Props) {
  const ref = useRef<HTMLElement>(null);
  const returnScope = useRef(activeFocusScope());
  useLayoutEffect(() => {
    ensureFocus(ref.current!);
    return () => {
      scheduleFocusReturn(returnScope.current, scope => {
        if (opener && focusables(scope).includes(opener)) focusElement(opener, false);
        else ensureFocus(scope);
      });
    };
  }, []);
  return (
    <div className="player-option-scrim" onClick={close}>
      <aside className="player-option-panel" ref={ref} role="dialog" aria-modal="true"
        aria-label={title} data-focus-scope data-back-label="取消" onClick={event => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label={`关闭${title}`} onClick={close}><X /></button>
        </header>
        <div className="player-option-list">
          {options.map((option, index) => (
            <button key={option.id} className="player-option" aria-pressed={option.id === value}
              data-option-id={option.id}
              data-focus-default={option.id === value || value === undefined && index === 0 || undefined}
              data-confirm-label="应用" onClick={() => choose(option.id)}>
              <span>{option.label}</span>{option.id === value && <Check size={18} />}
            </button>
          ))}
        </div>
        <footer data-input-hints-host />
      </aside>
    </div>
  );
}
