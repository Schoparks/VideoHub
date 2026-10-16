import { useLayoutEffect, useRef } from 'react';
import type { Folder } from '../shared/types';
import { activeFocusScope, ensureFocus, focusables, focusElement } from '../input/focus';
import { scheduleFocusReturn } from '../input/focus-return';

interface Props {
  folders: Folder[];
  folder: number;
  saving: boolean;
  change: (value: number) => void;
  favorite: (add: boolean) => void;
  close: () => void;
  opener: HTMLElement | null;
}

export function FavoritePicker({ folders, folder, saving, change, favorite, close, opener }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const returnScope = useRef(activeFocusScope());
  useLayoutEffect(() => {
    focusElement(ref.current?.querySelector('select') || ref.current?.querySelector('button'));
    return () => {
      scheduleFocusReturn(returnScope.current, scope => {
        if (opener && focusables(scope).includes(opener)) focusElement(opener, false);
        else ensureFocus(scope);
      });
    };
  }, []);
  return (
    <div className="favorite-panel" ref={ref} role="group" aria-label="B 站收藏夹">
      <label>选择 B 站收藏夹
        <select aria-label="B 站收藏夹" value={folder} disabled={!folders.length}
          aria-disabled={saving || undefined} data-focus-retain onChange={event => { if (!saving) change(Number(event.target.value)); }}>
          {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.title}</option>)}
        </select>
      </label>
      <button className="primary" disabled={!folder} aria-disabled={saving || undefined} data-focus-retain
        onClick={() => { if (!saving) favorite(true); }}>确认收藏</button>
      <button disabled={!folder} aria-disabled={saving || undefined} data-focus-retain
        onClick={() => { if (!saving) favorite(false); }}>取消此收藏</button>
      <button data-back-action aria-label="收起收藏夹" onClick={close}>收起</button>
      {!folders.length && <p>暂无收藏夹，请先在 B 站创建。</p>}
    </div>
  );
}
