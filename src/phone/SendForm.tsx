import { useEffect, useRef, useState } from 'react';
import { parseControllerCommand, type ControllerCommand } from '../shared/remote-control';

interface Props {
  kind: 'search' | 'url';
  value: string;
  change: (value: string) => void;
  close: () => void;
  send: (command: ControllerCommand) => Promise<{ error?: string }>;
}

export function SendForm({ kind, value, change, close, send }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const composing = useRef(false), finished = useRef(0), active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const submit = async () => {
    if (pending.current || composing.current || Date.now() - finished.current < 30) return;
    const command = parseControllerCommand({ kind, text: value });
    if (!command) { setError(kind === 'search' ? '请输入 200 字以内的关键词' : '请输入 HTTP(S) 地址或 BV 号'); return; }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await send(command);
      if (!active.current) return;
      if (result.error) setError(result.error);
      else close();
    }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <form className="send-form" autoComplete="off" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="remote-query">{kind === 'search' ? '搜索关键词' : '视频地址或 BV 号'}</label>
      <input id="remote-query" name={kind === 'search' ? 'search-query' : 'media-url'}
        type={kind === 'search' ? 'search' : 'text'} inputMode={kind === 'search' ? 'search' : 'url'}
        enterKeyHint={kind === 'search' ? 'search' : 'go'} value={value} autoFocus readOnly={busy}
        maxLength={kind === 'search' ? 200 : 10000} placeholder={kind === 'search' ? '输入关键词' : 'https://… 或 BV 号'}
        autoCapitalize="none" autoComplete="off" autoCorrect="off" spellCheck={false}
        data-form-type="other" data-lpignore="true" data-1p-ignore="true"
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; finished.current = Date.now(); }}
        onKeyDown={event => {
          if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
        }}
        onChange={event => { change(event.target.value); setError(''); }} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" disabled={busy || !value.trim()}>{busy ? '正在处理…' : kind === 'search' ? '在屏幕上搜索' : '打开视频'}</button>
    </form>;
}
