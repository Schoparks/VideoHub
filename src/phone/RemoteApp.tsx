import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Undo2, Menu, Monitor, Search, Link, SlidersHorizontal } from 'lucide-react';
import { controllerLabels, type ControllerAction, type ControllerCommand } from '../shared/remote-control';
import { checkConnection, connectionError, sendCommand } from './connection';
import { ControlButton } from './ControlButton';
import { Touchpad } from './Touchpad';
import { ShortcutSettings, loadShortcuts } from './ShortcutSettings';
import { SendForm } from './SendForm';
import { PhoneSheet } from './PhoneSheet';
import { ActionIcon } from './ActionIcon';

export function RemoteApp() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('正在连接…');
  const [shortcuts, setShortcuts] = useState(loadShortcuts);
  const [sheet, setSheet] = useState<'search' | 'url' | 'shortcuts' | null>(null);
  const [query, setQuery] = useState(''), [url, setUrl] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const openSheet = (kind: 'search' | 'url' | 'shortcuts', button: HTMLElement) => {
    opener.current = button;
    setSheet(kind);
  };
  const alive = useRef(true), inFlight = useRef(0), generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    let checking = false;
    const check = async () => {
      if (document.hidden || checking || inFlight.current) return;
      checking = true;
      const token = generation.current;
      try {
        await checkConnection();
        if (alive.current && token === generation.current) {
          setConnected(true);
          setStatus(previous => previous === '正在连接…' || previous.startsWith('连接') ? '已连接' : previous);
        }
      } catch (error) {
        if (alive.current && token === generation.current) { setConnected(false); setStatus(connectionError(error)); }
      } finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 4000);
    document.addEventListener('visibilitychange', check);
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, []);
  const send = useCallback(async (command: ControllerCommand) => {
    // Never queue stale navigation for replay after a slow connection.
    if (command.kind === 'action' && inFlight.current >= 2) return { error: '正在处理，请稍后再试' };
    const token = ++generation.current;
    inFlight.current++;
    if (command.kind !== 'action') setStatus(command.kind === 'url' ? '正在打开视频…' : '正在搜索…');
    try {
      await sendCommand(command);
      if (alive.current && token === generation.current) {
        setConnected(true);
        setStatus(command.kind === 'url' ? '视频已打开' : command.kind === 'search' ? '已提交搜索' : '已连接');
      }
      return {};
    } catch (error) {
      if (alive.current && token === generation.current) setStatus(connectionError(error));
      return { error: connectionError(error) };
    } finally { inFlight.current--; }
  }, []);
  const action = (action: ControllerAction) => { void send({ kind: 'action', action }); };
  return <><main className="remote">
    <header className="remote-header">
      <div><Monitor size={22} /><h1>映集遥控器</h1></div>
      <span className={connected ? 'connection online' : 'connection'}>{connected ? '在线' : '未连接'}</span>
    </header>
    <p className="status" role="status" aria-live="polite">{status}</p>
    <section className="navigation" aria-label="方向遥控">
      <div className="dpad">
        <ControlButton action="up" label="上" className="up" repeat send={action}><ChevronUp /></ControlButton>
        <ControlButton action="left" label="左" className="left" repeat send={action}><ChevronLeft /></ControlButton>
        <ControlButton action="confirm" label="确认" className="confirm" send={action} />
        <ControlButton action="right" label="右" className="right" repeat send={action}><ChevronRight /></ControlButton>
        <ControlButton action="down" label="下" className="down" repeat send={action}><ChevronDown /></ControlButton>
      </div>
      <div className="utility-row">
        <ControlButton action="back" label="返回" send={action}><Undo2 size={19} />返回</ControlButton>
        <ControlButton action="menu" label="菜单" send={action}><Menu size={19} />菜单</ControlButton>
      </div>
      <Touchpad send={action} />
    </section>
    <section className="shortcuts" aria-label="快捷操作">
      {shortcuts.map((item, index) => <ControlButton key={index} action={item} label={controllerLabels[item]} send={action}>
        <ActionIcon action={item} />
      </ControlButton>)}
    </section>
    <nav className="phone-tools" aria-label="输入与设置">
      <button type="button" onClick={event => openSheet('search', event.currentTarget)}><Search size={20} />搜索</button>
      <button type="button" onClick={event => openSheet('url', event.currentTarget)}><Link size={20} />链接</button>
      <button type="button" aria-label="自定义快捷键" onClick={event => openSheet('shortcuts', event.currentTarget)}><SlidersHorizontal size={20} /></button>
    </nav>
  </main>
    {sheet && <PhoneSheet title={sheet === 'search' ? '搜索' : sheet === 'url' ? '打开链接' : '自定义快捷键'} opener={opener.current} close={() => setSheet(null)}>
      {sheet === 'shortcuts' ? <ShortcutSettings value={shortcuts} change={setShortcuts} />
        : <SendForm kind={sheet} value={sheet === 'search' ? query : url} change={sheet === 'search' ? setQuery : setUrl}
          send={send} close={() => setSheet(null)} />}
    </PhoneSheet>}
  </>;
}
