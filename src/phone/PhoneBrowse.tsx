import { useEffect, useRef, useState } from 'react';
import type { CompanionCard, CompanionCommand, CompanionDynamic } from '../shared/companion';
import type { ControllerCommand, ControllerReply } from '../shared/remote-control';
import { connectionError } from './connection';
import { PhoneMediaList } from './PhoneMediaList';
import { navigation, type Route } from '../navigation';
import { PhoneBrowseFilters } from './PhoneBrowseFilters';
import { PhoneDynamics } from './PhoneDynamics';

export type PhoneCatalog = Extract<CompanionCommand, { kind: 'catalog' }>;
export function PhoneBrowse({ send, play, playing, request, change, route }: {
  send: (command: ControllerCommand) => Promise<ControllerReply>;
  play: (item: CompanionCard) => void; playing: boolean;
  request: PhoneCatalog; change: (request: PhoneCatalog) => void;
  route: Route;
}) {
  const [items, setItems] = useState<CompanionCard[]>([]);
  const [dynamics, setDynamics] = useState<CompanionDynamic[]>([]);
  const [more, setMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const page = useRef(0), cursor = useRef<string>(undefined), pending = useRef(false), revision = useRef(0);
  const load = async (reset: boolean, refresh = false) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const token = revision.current;
    try {
      const result = await send({ ...request, page: reset ? 1 : page.current + 1,
        cursor: reset ? undefined : cursor.current, refresh });
      if (token !== revision.current || !result.catalog) return;
      const data = result.catalog;
      setDynamics(previous => reset ? data.dynamics || [] : [...previous,
        ...(data.dynamics || []).filter(entry => !previous.some(old => old.handle === entry.handle))]);
      setItems(previous => reset || request.collection === 'recommend' ? data.items
        : [...previous, ...data.items.filter(item => !previous.some(saved => saved.handle === item.handle))]);
      setMore(data.hasMore);
      cursor.current = data.cursor;
      page.current = reset ? 1 : page.current + 1;
      setError('');
    } catch (failure) { if (token === revision.current) setError(connectionError(failure)); }
    finally { if (token === revision.current) { pending.current = false; setBusy(false); } }
  };
  useEffect(() => {
    revision.current++;
    pending.current = false;
    page.current = 0;
    setItems([]); setDynamics([]); setMore(false); setError('');
    void load(true);
    return () => { revision.current++; };
  }, [request]);
  return <section className="phone-browse" aria-label="视频浏览">
    <PhoneBrowseFilters route={route} request={request} change={change} />
    {request.collection === 'search' && <label className="phone-field">搜索类型<select value={request.searchType}
      disabled={busy} onChange={event => change({ ...request, searchType: event.target.value as PhoneCatalog['searchType'] })}>
      <option value="all">全部</option><option value="video">视频</option><option value="media_bangumi">番剧</option>
      <option value="media_ft">影视</option><option value="live_room">直播</option>
    </select></label>}
    <div className="phone-section-heading"><h2>{request.collection === 'search' ? `“${request.keyword}”`
      : route === 'home' ? '为你推荐' : navigation.find(item => item.id === route)?.label}</h2>
      <button disabled={busy} onClick={() => void load(true, true)}>刷新</button></div>
    {error && <p className="form-error" role="alert">{error} <button disabled={busy} onClick={() => void load(!page.current)}>重试</button></p>}
    {!busy && !error && !items.length && !dynamics.length && <p className="phone-empty">暂无内容</p>}
    {request.collection === 'dynamic' && dynamics.length ? <PhoneDynamics entries={dynamics} busy={playing} play={play} />
      : <PhoneMediaList items={items} busy={playing} play={play} context={{ collection: request.collection, changed: () => void load(true, true) }} />}
    {busy ? <p role="status">正在加载…</p> : more && <button className="phone-load" onClick={() => void load(false)}>加载更多</button>}
  </section>;
}
