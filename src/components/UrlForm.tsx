import { useEffect, useId, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useImeGuard } from '../input/use-ime-guard';

interface Props {
  value: string;
  opening: boolean;
  change: (value: string) => void;
  open: (failure: (message: string) => void) => Promise<void>;
}

export function UrlForm({ value, opening, change, open }: Props) {
  const [error, setError] = useState('');
  const active = useRef(false), operation = useRef(0), submitted = useRef(false);
  const errorId = useId();
  const ime = useImeGuard();
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; operation.current++; };
  }, []);
  const submit = () => {
    if (opening || submitted.current || !value.trim() || ime.pending()) return;
    const token = ++operation.current;
    submitted.current = true;
    const fail = (message: string) => {
      if (active.current && token === operation.current) setError(message);
    };
    void open(fail).finally(() => { submitted.current = false; });
  };
  return (
    <form className="url-form" aria-busy={opening} onSubmit={event => { event.preventDefault(); submit(); }}>
      <label>视频地址
        <input autoFocus aria-label="视频地址" placeholder="https://… 或 BV 号" value={value}
          readOnly={opening} aria-disabled={opening || undefined} data-focus-retain={opening || undefined}
          aria-describedby={error ? errorId : undefined} spellCheck={false} autoComplete="off" required
          onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd} onKeyDown={ime.onKeyDown}
          onChange={event => {
            if (opening || submitted.current) return;
            operation.current++;
            setError('');
            change(event.target.value);
          }} />
      </label>
      <p className="small muted">{window.hubPlatform === 'android' ? '支持媒体直链及 BV 号。' : '支持视频网页、媒体直链及 BV 号。'}</p>
      {error && <p className="error-message" id={errorId} role="alert">{error}</p>}
      <button className="primary" disabled={!value.trim()} aria-disabled={opening || undefined}
        data-focus-retain={opening || undefined}>
        <Play size={17} />{opening ? '正在解析…' : '打开视频'}
      </button>
    </form>
  );
}
