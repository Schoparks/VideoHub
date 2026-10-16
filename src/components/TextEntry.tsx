import { useRef, useState } from 'react';
import { Modal } from './Modal';
import { ScreenKeyboard, type KeyboardHandle } from './ScreenKeyboard';
import { useImeGuard } from '../input/use-ime-guard';

interface Props {
  input: HTMLInputElement;
  close: (value?: string) => void;
}

export function TextEntry({ input, close }: Props) {
  const [value, setValue] = useState(input.value);
  const edit = useRef<HTMLInputElement>(null), keyboard = useRef<KeyboardHandle>(null);
  const [draft, setDraft] = useState(false);
  const ime = useImeGuard();
  return (
    <Modal title={input.getAttribute('aria-label') || '输入文本'} close={() => close()}>
      <div className="search-dialog">
        <form onSubmit={event => { event.preventDefault(); if (!ime.pending()) keyboard.current?.complete(); }}>
          <input ref={edit} aria-label="输入内容" value={value} onChange={event => setValue(event.target.value)}
            onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd} onKeyDown={ime.onKeyDown} />
          <button className="primary" data-focus-default>{draft ? '确认输入' : '完成'}</button>
        </form>
        <ScreenKeyboard ref={keyboard} value={value} change={setValue} input={edit} submit={close} draft={setDraft} punctuation />
      </div>
    </Modal>
  );
}
