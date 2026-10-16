import { useLayoutEffect, useRef } from 'react';
import { Play, X } from 'lucide-react';
import type { MediaPart } from '../shared/types';
import { activeFocusScope, ensureFocus, focusables, focusElement } from '../input/focus';
import { scheduleFocusReturn } from '../input/focus-return';
import { time } from '../api';
import './player-menu-scroll.css';
import './player-menu-hints.css';

interface Props {
  parts: MediaPart[];
  current?: MediaPart;
  autoNext: boolean;
  ended: boolean;
  switching: boolean;
  opener: HTMLElement | null;
  choose: (part: MediaPart) => void;
  close: () => void;
}

export function EpisodePicker({ parts, current, autoNext, ended, switching, opener, choose, close }: Props) {
  const ref = useRef<HTMLElement>(null);
  const returnScope = useRef(activeFocusScope());
  useLayoutEffect(() => {
    ensureFocus(ref.current!);
    return () => {
      scheduleFocusReturn(returnScope.current, scope => {
        if (opener?.isConnected && focusables(scope).includes(opener)) focusElement(opener, false);
        else ensureFocus(scope);
      });
    };
  }, []);
  return (
    <div className="episode-scrim" onClick={close}>
      <aside className="episode-panel" ref={ref} role="dialog" aria-modal="true" aria-label="选择分集" data-focus-scope onClick={event => event.stopPropagation()}>
        <header>
          <div><h2>选择分集</h2><p>共 {parts.length} 集 · {autoNext ? '自动播放下一集' : '手动切换分集'}</p></div>
          <button className="icon-button" aria-label="关闭选集" onClick={close}><X /></button>
        </header>
        <div className="episode-list">
          {parts.map((part, index) => (
            <button
              key={part.id}
              className={`episode-option ${part.id === current?.id ? 'selected' : ''}`}
              data-focus-default={part.id === current?.id || undefined}
              aria-current={part.id === current?.id ? 'true' : undefined}
              disabled={switching}
              onClick={() => choose(part)}
            >
              <span className="episode-number">{String(index + 1).padStart(2, '0')}</span>
              <span>
                <b>{part.title || `第 ${index + 1} 集`}</b>
                <small>{part.id === current?.id ? ended ? '已播完' : '正在观看' : `第 ${index + 1} 集`}{part.duration ? ` · ${time(part.duration)}` : ''}</small>
              </span>
              {part.id === current?.id && <Play size={15} fill="currentColor" />}
            </button>
          ))}
        </div>
        <footer className="episode-panel-hint" data-input-hints-host />
      </aside>
    </div>
  );
}
