import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FolderHeart, QrCode, RefreshCw } from 'lucide-react';
import type { CompanionCard, CompanionState } from '../shared/companion';
import type { ControllerCommand, ControllerReply } from '../shared/remote-control';
import { PhoneMediaList } from './PhoneMediaList';
import { connectionError } from './connection';
import { browseTabs } from '../browse-sections';

type LibraryTab = 'favorites' | 'queue' | 'watchlater' | 'history' | 'localHistory';
const labels = Object.fromEntries(browseTabs.mine!);

export function PhoneLibrary({ send, play, busy: playing, account }: {
  send: (command: ControllerCommand) => Promise<ControllerReply>;
  play: (item: CompanionCard) => void; busy: boolean; account: CompanionState['account'];
}) {
  const [tab, setTab] = useState<LibraryTab>('favorites');
  const [folders, setFolders] = useState<ControllerReply['folders']>();
  const [folder, setFolder] = useState<NonNullable<ControllerReply['folders']>[number]>();
  const [items, setItems] = useState<CompanionCard[]>([]), [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const page = useRef(0), revision = useRef(0), pending = useRef(false);
  const cursor = useRef<string>(undefined);
  const load = async (reset = true) => {
    if (pending.current) return;
    const token = revision.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const reply = tab === 'favorites' && !folder ? await send({ kind: 'folders' })
        : await send({ kind: 'catalog', collection: tab, folder: folder?.handle, page: reset ? 1 : page.current + 1,
          cursor: reset ? undefined : cursor.current, refresh: reset });
      if (token !== revision.current) return;
      if (reply.folders) setFolders(reply.folders);
      if (reply.catalog) {
        setItems(previous => reset ? reply.catalog!.items : [...previous,
          ...reply.catalog!.items.filter(item => !previous.some(old => old.handle === item.handle))]);
        setMore(reply.catalog.hasMore); page.current = reset ? 1 : page.current + 1;
        cursor.current = reply.catalog.cursor;
      }
    } catch (failure) { if (token === revision.current) setError(connectionError(failure)); }
    finally { if (token === revision.current) { pending.current = false; setBusy(false); } }
  };
  useEffect(() => {
    revision.current++; pending.current = false; page.current = 0; cursor.current = undefined;
    setItems([]); setFolders(undefined); setMore(false); void load();
    return () => { revision.current++; };
  }, [tab, folder]);
  const login = async (operation: 'app' | 'web' | 'close') => {
    try { await send({ kind: 'tv-login', operation }); setError(''); }
    catch (failure) { setError(connectionError(failure)); }
  };
  return <section className="phone-library" aria-label="我的视频">
    <div className="phone-login-links">
      <button onClick={() => void login('app')}><QrCode size={20} /><span>电视推荐授权二维码</span>
        <small>{account?.app ? '已连接' : '未连接'}</small></button>
      <button onClick={() => void login('web')}><QrCode size={20} /><span>电视账号登录二维码</span>
        <small>{account?.web ? '已连接' : '未连接'}</small></button>
      {account?.screen && <button onClick={() => void login('close')}>关闭电视二维码</button>}
    </div>
    <nav className="phone-categories" aria-label="我的分类">
      {browseTabs.mine!.map(([value, label]) => <button key={value} aria-pressed={tab === value}
        disabled={busy} onClick={() => { setTab(value as LibraryTab); setFolder(undefined); }}>{label}</button>)}
    </nav>
    <div className="phone-section-heading">
      {folder ? <button aria-label="返回收藏夹" onClick={() => setFolder(undefined)}><ArrowLeft size={20} /></button> : null}
      <h2>{folder?.title || labels[tab]}</h2>
      <button aria-label="刷新我的视频" disabled={busy} onClick={() => void load()}><RefreshCw size={18} /></button>
    </div>
    {error && <p className="form-error" role="alert">{error} <button disabled={busy} onClick={() => void load()}>重试</button></p>}
    {tab === 'favorites' && !folder ? <div className="phone-action-list">
      {folders?.map(value => <button key={value.handle} onClick={() => setFolder(value)}>
        <FolderHeart size={22} /><span>{value.title}</span><small>{value.count}</small></button>)}
      {folders?.length === 0 && <p className="phone-empty">暂无收藏夹</p>}
    </div> : <>
      <PhoneMediaList items={items} busy={playing || busy} play={play}
        context={{ collection: tab, folder: folder?.handle, changed: () => void load() }} />
      {!busy && !error && !items.length && <p className="phone-empty">暂无视频</p>}
      {more && <button className="phone-load" disabled={busy} onClick={() => void load(false)}>加载更多</button>}
    </>}
    {busy && <p role="status">正在加载…</p>}
  </section>;
}
