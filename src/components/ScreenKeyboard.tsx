import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { activeFocusScope, focusElement } from '../input/focus';
import { scheduleFocusReturn } from '../input/focus-return';
import { loadPinyin, type PinyinIndex } from '../input/pinyin';
import { deleteText, replaceText } from '../input/text-editing';
import type { Action } from '../input/gamepad';
import '../styles/screen-keyboard.css';

export interface KeyboardHandle { complete(): void }
interface Props {
  value: string;
  change: (value: string) => void;
  input: RefObject<HTMLInputElement | null>;
  submit: (value: string) => void;
  draft: (pending: boolean) => void;
  punctuation?: boolean;
}

export const ScreenKeyboard = forwardRef<KeyboardHandle, Props>(function ScreenKeyboard(props, ref) {
  const { value, change, input, submit, draft, punctuation } = props;
  const [language, setLanguage] = useState(punctuation ? 'en' : 'zh');
  const [numbers, setNumbers] = useState(false), [upper, setUpper] = useState(false);
  const [buffer, setBuffer] = useState(''), [page, setPage] = useState(0);
  const [dictionary, setDictionary] = useState<PinyinIndex>();
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null), lastKey = useRef<HTMLElement | null>(null);
  const pendingCaret = useRef<{ value: string; caret: number } | undefined>(undefined);
  const candidates = dictionary?.candidates(buffer) || [];
  const pages = Math.max(1, Math.ceil(candidates.length / 5));
  useEffect(() => {
    if (language !== 'zh' || dictionary) return;
    let canceled = false;
    setError(false);
    void loadPinyin().then(value => { if (!canceled) setDictionary(value); })
      .catch(() => { if (!canceled) setError(true); });
    return () => { canceled = true; };
  }, [language, dictionary, attempt]);
  useEffect(() => { draft(!!buffer); }, [buffer, draft]);
  useEffect(() => { setPage(0); }, [buffer]);
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    pendingCaret.current = undefined;
    if (pending?.value === value) input.current?.setSelectionRange(pending.caret, pending.caret);
  }, [value, input]);
  const edit = (text: string, deletion = false) => {
    const start = input.current?.selectionStart ?? value.length;
    const end = input.current?.selectionEnd ?? start;
    const result = deletion ? deleteText(value, start, end) : replaceText(value, text, start, end);
    pendingCaret.current = result;
    change(result.value);
    if (result.value === value) {
      pendingCaret.current = undefined;
      input.current?.setSelectionRange(result.caret, result.caret);
    }
    return result.value;
  };
  const commitBuffer = (text: string, consumed: number) => {
    edit(text);
    setBuffer(buffer.slice(consumed));
    scheduleFocusReturn(activeFocusScope(), () => {
      focusElement(lastKey.current || root.current?.querySelector('[data-keyboard-start]'), false);
    });
  };
  const choose = (index: number) => {
    const candidate = candidates[index];
    if (candidate) commitBuffer(candidate.text, candidate.consumed);
  };
  const confirmBuffer = () => {
    if (candidates.length) choose(page * 5);
    else if (dictionary || language === 'en') commitBuffer(buffer, buffer.length);
  };
  const complete = () => {
    if (buffer) confirmBuffer();
    else submit(value);
  };
  useImperativeHandle(ref, () => ({ complete }));
  const backspace = () => {
    if (buffer) setBuffer(buffer.slice(0, -1));
    else edit('', true);
  };
  const clear = () => { setBuffer(''); change(''); };
  const switchLanguage = () => {
    if (buffer) { edit(buffer); setBuffer(''); }
    setLanguage(language === 'zh' ? 'en' : 'zh');
    setNumbers(false);
  };
  const switchNumbers = () => {
    if (buffer) { edit(buffer); setBuffer(''); }
    setNumbers(!numbers);
  };
  const type = (letter: string, key: HTMLElement) => {
    lastKey.current = key;
    if (language === 'zh' && !numbers && /^[a-z]$/.test(letter)) setBuffer(buffer + letter);
    else edit(letter);
  };
  useEffect(() => {
    const action = (event: Event) => {
      if (activeFocusScope().querySelector('.screen-keyboard') !== root.current) return;
      const inputEvent = event as CustomEvent<Action>;
      const handlers: Partial<Record<Action, () => void>> = {
        details: backspace, search: complete, pause: complete, previous: switchLanguage,
        next: switchNumbers, rewind: clear,
        back: buffer ? () => setBuffer('') : undefined,
      };
      const handler = handlers[inputEvent.detail];
      if (handler) { inputEvent.preventDefault(); handler(); }
    };
    document.addEventListener('hub-input-action', action);
    return () => document.removeEventListener('hub-input-action', action);
  });
  const rows = numbers ? ['1234567890', '.:/-_?=&%', '#+@()[]!'] : ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  return (
    <div ref={root} className="screen-keyboard" aria-label="屏幕键盘"
      data-screen-keyboard data-composing={!!buffer} data-submit-label={buffer ? '确认输入' : punctuation ? '完成' : '搜索'}>
      <div className="keyboard-toolbar">
        <button type="button" onClick={switchLanguage} aria-label="切换中英文" data-state-label={language === 'zh' ? '中文' : 'English'}>{language === 'zh' ? '中文' : 'English'}</button>
        <button type="button" onClick={switchNumbers} aria-pressed={numbers}>数字/符号</button>
        {language === 'en' && !numbers && <button type="button" onClick={() => setUpper(!upper)} aria-pressed={upper}>大写</button>}
        <button type="button" onClick={backspace} aria-disabled={!value && !buffer || undefined} data-focus-retain>退格</button>
        <button type="button" onClick={clear} aria-disabled={!value && !buffer || undefined} data-focus-retain>清空</button>
      </div>
      {language === 'zh' && <div className="pinyin-candidates">
        <output aria-label="待选拼音">{buffer || '拼音'}</output>
        {error ? <button type="button" onClick={() => setAttempt(value => value + 1)}>词库加载失败 · 重试</button>
          : !dictionary ? <span role="status">正在加载词库…</span> : buffer && !candidates.length ? <span>无候选词</span> : null}
        <div className="candidate-row">
          {candidates.slice(page * 5, page * 5 + 5).map((candidate, index) => (
            <button key={candidate.text} type="button" onClick={() => choose(page * 5 + index)} title={candidate.text}>{candidate.text}</button>
          ))}
        </div>
        {!!candidates.length && <div className="candidate-pages">
          <button type="button" aria-label="上一页候选" aria-disabled={page === 0 || undefined} data-focus-retain onClick={() => setPage(Math.max(0, page - 1))}>‹</button>
          <span>{page + 1}/{pages}</span>
          <button type="button" aria-label="下一页候选" aria-disabled={page + 1 >= pages || undefined} data-focus-retain onClick={() => setPage(Math.min(pages - 1, page + 1))}>›</button>
        </div>}
      </div>}
      <div className="keyboard-keys">
        {rows.map((row, index) => <div className="keyboard-row" key={index}>
          {[...row].map((letter, position) => {
            const text = upper && language === 'en' && !numbers ? letter.toUpperCase() : letter;
            return <button key={letter} type="button" data-keyboard-start={index === 0 && position === 0 || undefined}
              onClick={event => type(text, event.currentTarget)}>{text}</button>;
          })}
        </div>)}
        <div className="keyboard-row keyboard-bottom">
          <button type="button" onClick={() => buffer ? confirmBuffer() : edit(' ')}>空格</button>
        </div>
      </div>
    </div>
  );
});
