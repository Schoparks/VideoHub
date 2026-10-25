import { useRef, useState } from 'react';
import { ArrowUp, Gamepad2 } from 'lucide-react';
import type { CompanionCard } from '../shared/companion';
import { useCompanionConnection } from './useCompanionConnection';
import { PhoneBrowse, type PhoneCatalog } from './PhoneBrowse';
import { PhoneSearch } from './PhoneSearch';
import { PhonePlayer } from './PhonePlayer';
import { PhoneSettings } from './PhoneSettings';
import { RemoteButtons } from './RemoteButtons';
import { PhoneSheet } from './PhoneSheet';
import { SendForm } from './SendForm';
import { connectionError } from './connection';
import { PhoneLibrary } from './PhoneLibrary';
import { PhoneMediaActions } from './PhoneMediaActions';
import './companion.css';
import { PhoneToolbar, phoneTools, type PhoneTool } from './PhoneToolbar';
import { usePhoneView } from './usePhoneView';
import { PhoneHistory } from './PhoneHistory';
import type { Route } from '../navigation';

export function RemoteApp() {
  const connection = useCompanionConnection();
  const [sheet, setSheet] = useState<PhoneTool>(), [url, setUrl] = useState('');
  const [fromTools, setFromTools] = useState(false);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<PhoneCatalog>({ kind: 'catalog', collection: 'recommend' });
  const [route, setRoute] = useState<Route>('home');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const opener = useRef<HTMLElement | null>(null), pending = useRef(false);
  const linkToken = useRef(0);
  const state = connection.state;
  const navigation = usePhoneView(state ? !!state.player : undefined,
    state?.player ? `${state.current?.handle}:${state.player.part || ''}` : '');
  const { view, content, scrolled } = navigation;
  const play = async (item: CompanionCard) => {
    if (pending.current) return;
    const token = navigation.checkpoint();
    pending.current = true; setBusy(true); setError('');
    try { await connection.send({ kind: 'play', handle: item.handle }); if (navigation.opened(token)) setSheet(undefined); }
    catch (failure) { if (navigation.isCurrent(token)) setError(connectionError(failure)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <PhoneMediaActions key={state?.catalogVersion} send={connection.send}><main className="companion">
    <PhoneToolbar player={view === 'player'} online={connection.online} ready={!!state} home={navigation.home}
      source={route} browse={next => {
        navigation.home(); setRoute(next);
        if (next !== 'mine') setCatalog({ kind: 'catalog', collection: next === 'live' ? 'followingLive'
          : next === 'cinema' ? 'cinema' : next === 'local' ? 'local' : 'recommend', category: next === 'cinema' ? 1 : undefined });
        content.current?.scrollTo({ top: 0 });
      }}
      open={(id, element) => { navigation.interact(); opener.current = element; setFromTools(false); setSheet(id); setError(''); }} />
    <div className="companion-content" ref={content} onScroll={navigation.scroll}>
      {connection.error && <div className="connection-error" role="status"><p>{connection.error}</p>
        <button onClick={() => void connection.refresh()}>重新连接</button></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {busy && <p role="status">正在打开视频…</p>}
      {state && <>
        <div hidden={view !== 'home'}>{route === 'mine'
          ? <PhoneLibrary key={state.catalogVersion} account={state.account} send={connection.send} play={item => void play(item)} busy={busy || state.opening} />
          : <PhoneBrowse key={state.catalogVersion} send={connection.send} route={route}
            request={catalog} change={setCatalog} play={item => void play(item)} playing={busy || state.opening} />}</div>
        <div hidden={view !== 'player'}><PhonePlayer player={state.player} current={state.current}
          preferences={state.preferences} send={connection.send}
          play={item => void play(item)} playing={busy || state.opening} /></div>
      </>}
    </div>
    <div className="phone-floating">
      {scrolled && <button aria-label="返回顶部" onClick={navigation.top}><ArrowUp size={23} /></button>}
      {view === 'home' && state?.player && <button className="phone-remote-bubble" aria-label="打开播放遥控器" onClick={navigation.showPlayer}><Gamepad2 size={27} /></button>}
    </div>
    {sheet && state && <PhoneSheet title={sheet === 'tools' ? '工具' : sheet === 'history' ? '历史记录' : sheet === 'search' ? '搜索' : phoneTools.find(tool => tool.id === sheet)!.label} opener={opener.current}
      className={sheet === 'settings' ? 'phone-settings-sheet' : undefined}
      back={fromTools && sheet !== 'tools' ? () => { navigation.interact(); setSheet('tools'); setFromTools(false); setError(''); } : undefined}
      close={() => { navigation.interact(); setSheet(undefined); }}>
      {sheet === 'search' && <PhoneSearch value={query} change={setQuery} submit={keyword => {
        navigation.home(); setRoute('search'); setCatalog({ kind: 'catalog', collection: 'search', keyword, searchType: 'all' });
        setSheet(undefined); content.current?.scrollTo({ top: 0 });
      }} />}
      {(sheet === 'library' || sheet === 'history') && error && <p className="form-error" role="alert">{error}</p>}
      {(sheet === 'library' || sheet === 'history') && busy && <p role="status">正在打开视频…</p>}
      {sheet === 'tools' && <div className="phone-tool-menu">{phoneTools.map(({ id, label, Icon }) =>
        <button key={id} onClick={() => { navigation.interact(); setFromTools(true); setSheet(id); }}><Icon size={21} /><span>{label}</span></button>)}</div>}
      {sheet === 'history' && <PhoneHistory account={state.account} send={connection.send} play={item => void play(item)} playing={busy || state.opening} />}
      {sheet === 'library' && <PhoneLibrary account={state.account} send={connection.send} play={item => void play(item)} busy={busy || state.opening} />}
      {sheet === 'settings' && <PhoneSettings value={state.preferences} send={connection.send} />}
      {sheet === 'remote' && <RemoteButtons send={connection.send} />}
      {sheet === 'link' && <SendForm kind="url" value={url} change={setUrl} close={() => { if (navigation.opened(linkToken.current)) setSheet(undefined); }}
        send={async command => {
          linkToken.current = navigation.checkpoint();
          try { await connection.send(command); return {}; }
          catch (failure) { return { error: connectionError(failure) }; }
        }} />}
    </PhoneSheet>}
  </main></PhoneMediaActions>;
}
