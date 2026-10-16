import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { ScreenKeyboard, type KeyboardHandle } from './ScreenKeyboard';
import { useImeGuard } from '../input/use-ime-guard';

interface Props {
  value: string;
  submit: (value: string) => void;
}

export function SearchInput({ value: initialValue, submit }: Props) {
  const [value, change] = useState(initialValue);
  const input = useRef<HTMLInputElement>(null), keyboard = useRef<KeyboardHandle>(null);
  const [draft, setDraft] = useState(false);
  const ime = useImeGuard();
  return (
    <div className="search-dialog">
      <form onSubmit={event => { event.preventDefault(); if (!ime.pending()) keyboard.current?.complete(); }}>
        <Search size={20} />
        <input ref={input} aria-label="搜索关键词" autoFocus value={value} onChange={event => change(event.target.value)}
          placeholder="输入关键词" onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd} onKeyDown={ime.onKeyDown} />
        <button className="primary" disabled={!value.trim() && !draft}>{draft ? '确认输入' : '搜索'}</button>
      </form>
      <div className="chips" aria-label="快捷关键词">
        {['纪录片', '旅行', '游戏', '音乐', '科技', '美食'].map(word => (
          <button key={word} onClick={() => change(value + word)}>{word}</button>
        ))}
      </div>
      <ScreenKeyboard ref={keyboard} value={value} change={change} input={input} submit={submit} draft={setDraft} />
    </div>
  );
}
