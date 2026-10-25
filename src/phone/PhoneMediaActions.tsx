import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Clock, FolderHeart, ListPlus, Trash2 } from 'lucide-react';
import type { CompanionCard } from '../shared/companion';
import type { ControllerCommand, ControllerReply } from '../shared/remote-control';
import { PhoneSheet } from './PhoneSheet';
import { connectionError } from './connection';

export interface MediaActionTarget {
  item: CompanionCard;
  collection?: string;
  folder?: string;
  changed?: () => void;
}
const Actions = createContext<(target: MediaActionTarget, opener: HTMLElement) => void>(() => {});
export const usePhoneMediaActions = () => useContext(Actions);

export function PhoneMediaActions({ send, children }: {
  send: (command: ControllerCommand) => Promise<ControllerReply>; children: ReactNode;
}) {
  const [target, setTarget] = useState<MediaActionTarget>();
  const [folders, setFolders] = useState<ControllerReply['folders']>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const opener = useRef<HTMLElement | null>(null), pending = useRef(false), revision = useRef(0);
  const close = () => { revision.current++; setTarget(undefined); setFolders(undefined); };
  const run = async (command: ControllerCommand, success: string) => {
    if (pending.current) return;
    const token = revision.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const reply = await send(command);
      if (token !== revision.current) return;
      if (command.kind === 'folders') { setFolders(reply.folders || []); return; }
      target?.changed?.(); setNotice(success); close();
    } catch (failure) { if (token === revision.current) setError(connectionError(failure)); }
    finally { pending.current = false; setBusy(false); }
  };
  const item = target?.item;
  return <Actions.Provider value={(value, element) => {
    if (pending.current) return;
    revision.current++; opener.current = element; setTarget(value); setFolders(undefined); setError(''); setNotice('');
  }}>
    {children}
    {notice && <div className="phone-feedback" role="status"><span>{notice}</span>
      <button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
    {item && <PhoneSheet title={folders ? '收藏到' : '视频操作'} opener={opener.current} close={close}>
      <p className="phone-action-title">{item.title}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="phone-action-list">
        {folders ? <>
          {!folders.length && <p className="phone-empty">暂无收藏夹</p>}
          {folders.map(folder => <button key={folder.handle} disabled={busy} onClick={() => void run({
            kind: 'collection-edit', handle: item.handle, collection: 'favorites', folder: folder.handle, add: true,
          }, '已收藏')}><FolderHeart size={20} /><span>{folder.title}</span><small>{folder.count}</small></button>)}
          <button disabled={busy} onClick={() => setFolders(undefined)}>返回</button>
        </> : <>
          <button disabled={busy} onClick={() => void run({ kind: 'queue-edit', operation: 'add', handle: item.handle }, '已加入队列')}>
            <ListPlus size={20} /><span>加入播放队列</span></button>
          {target.collection === 'queue' && <>
            <button disabled={busy} onClick={() => void run({ kind: 'queue-edit', operation: 'up', handle: item.handle }, '队列已更新')}>
              <ArrowUp size={20} /><span>上移</span></button>
            <button disabled={busy} onClick={() => void run({ kind: 'queue-edit', operation: 'down', handle: item.handle }, '队列已更新')}>
              <ArrowDown size={20} /><span>下移</span></button>
            <button disabled={busy} onClick={() => void run({ kind: 'queue-edit', operation: 'remove', handle: item.handle }, '已移出队列')}>
              <Trash2 size={20} /><span>移出队列</span></button>
          </>}
          {item.source === 'bilibili' && item.kind === 'video' && <>
            <button disabled={busy} onClick={() => void run({ kind: 'folders' }, '')}>
              <FolderHeart size={20} /><span>收藏到…</span></button>
            {target.folder && <button disabled={busy} onClick={() => void run({ kind: 'collection-edit', handle: item.handle,
              collection: 'favorites', folder: target.folder, add: false }, '已从收藏夹移除')}>
              <Trash2 size={20} /><span>从此收藏夹移除</span></button>}
            <button disabled={busy} onClick={() => void run({ kind: 'collection-edit', handle: item.handle,
              collection: 'watchlater', add: target.collection !== 'watchlater' }, target.collection === 'watchlater' ? '已移出稍后再看' : '已加入稍后再看')}>
              <Clock size={20} /><span>{target.collection === 'watchlater' ? '移出稍后再看' : '稍后再看'}</span></button>
          </>}
        </>}
      </div>
      {busy && <p role="status">正在处理…</p>}
    </PhoneSheet>}
  </Actions.Provider>;
}
