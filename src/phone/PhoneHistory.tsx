import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CompanionCard, CompanionState } from '../shared/companion';
import type { ControllerCommand, ControllerReply } from '../shared/remote-control';
import { PhoneMediaList } from './PhoneMediaList';
import { connectionError } from './connection';

export function PhoneHistory({ account, send, play, playing }: {
  account: CompanionState['account']; playing: boolean;
  send: (command: ControllerCommand) => Promise<ControllerReply>; play: (item: CompanionCard) => void;
}) {
  const [collection, setCollection] = useState<'history' | 'localHistory'>(account?.web ? 'history' : 'localHistory');
  const [items, setItems] = useState<CompanionCard[]>([]), [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const revision = useRef(0), pending = useRef(false), page = useRef(0), cursor = useRef<string>(undefined);
  const load = async (reset: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    const token = revision.current;
    try {
      const reply = await send({ kind: 'catalog', collection, page: reset ? 1 : page.current + 1,
        cursor: reset ? undefined : cursor.current, refresh: reset });
      if (token !== revision.current || !reply.catalog) return;
      const data = reply.catalog;
      setItems(previous => reset ? data.items : [...previous, ...data.items.filter(item => !previous.some(old => old.handle === item.handle))]);
      page.current = reset ? 1 : page.current + 1; cursor.current = data.cursor;
      setMore(data.hasMore); setError('');
    } catch (failure) { if (token === revision.current) setError(connectionError(failure)); }
    finally { if (token === revision.current) { pending.current = false; setBusy(false); } }
  };
  useEffect(() => {
    revision.current++; pending.current = false; page.current = 0; cursor.current = undefined;
    setItems([]); setError(''); setMore(false); void load(true);
    return () => { revision.current++; };
  }, [collection]);
  return <section className="phone-history" aria-label="观看历史">
    <div className="phone-history-tools"><nav className="phone-setting-tabs" aria-label="历史来源">
      <button aria-pressed={collection === 'history'} onClick={() => setCollection('history')}>B 站历史</button>
      <button aria-pressed={collection === 'localHistory'} onClick={() => setCollection('localHistory')}>本机历史</button>
    </nav><button aria-label="刷新历史" disabled={busy} onClick={() => void load(true)}><RefreshCw size={18} /></button></div>
    {error && <p className="form-error" role="alert">{error} <button disabled={busy} onClick={() => void load(!page.current)}>重试</button></p>}
    {!busy && !error && !items.length && <p className="phone-empty">暂无观看记录</p>}
    <PhoneMediaList items={items} busy={playing} play={play} />
    {busy ? <p role="status">正在加载…</p> : more && <button className="phone-load" onClick={() => void load(false)}>加载更多</button>}
  </section>;
}
