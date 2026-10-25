import { useRef } from 'react';

export function PhoneSearch({ value, change, submit }: {
  value: string; change: (value: string) => void; submit: (keyword: string) => void;
}) {
  const composing = useRef(false), compositionEnd = useRef(0);
  return <form className="phone-search" autoComplete="off" onSubmit={event => {
    event.preventDefault();
    if (!value.trim() || composing.current || Date.now() - compositionEnd.current < 30) return;
    submit(value.trim());
  }}>
    <input type="search" name="search-query" aria-label="搜索关键词" inputMode="search" enterKeyHint="search"
      autoComplete="off" maxLength={200} value={value} placeholder="搜索 B 站视频、番剧、直播"
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; compositionEnd.current = Date.now(); }}
      onChange={event => change(event.target.value)} />
    <button type="submit" disabled={!value.trim()}>搜索</button>
  </form>;
}
