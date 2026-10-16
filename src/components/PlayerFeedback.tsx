import { useLayoutEffect, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { ensureFocus } from '../input/focus';
import { time } from '../api';

interface Props {
  loading: boolean;
  error: string;
  busy: boolean;
  exiting: boolean;
  covered: boolean;
  seek?: number;
  retry: () => void;
  quality?: (opener: HTMLElement) => void;
  leave: () => void;
}

export function PlayerFeedback({ loading, error, busy, exiting, covered, seek, retry, quality, leave }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (error && ref.current) ensureFocus(ref.current); }, [error]);
  return (
    <>
      {loading && !error && <div className="player-center" role="status"><span className="loader" /><p>正在准备画面…</p></div>}
      {error && (
        <div ref={ref} className="player-center player-error" role="alert" inert={covered}
          data-focus-scope data-back-label="返回浏览">
          <h2>暂时无法播放</h2><p>{error}</p>
          <div className="button-row">
            <button className="primary" data-focus-default aria-disabled={busy || exiting || undefined}
              data-focus-retain={busy || exiting || undefined} onClick={() => { if (!busy && !exiting) retry(); }}>
              <RotateCcw size={18} />{busy ? '正在重试…' : '重试'}
            </button>
            {quality && <button aria-haspopup="dialog" aria-disabled={busy || exiting || undefined}
              data-focus-retain onClick={event => { if (!busy && !exiting) quality(event.currentTarget); }}>
              选择清晰度
            </button>}
            <button onClick={leave} aria-label="返回浏览" data-player-leave aria-busy={exiting || undefined}
              aria-disabled={exiting || undefined} data-focus-retain={exiting || undefined}>{exiting ? '正在返回…' : '返回浏览'}</button>
          </div>
          <footer data-input-hints-host />
        </div>
      )}
      {seek !== undefined && <div className="seek-preview"><strong>{time(seek)}</strong></div>}
    </>
  );
}
