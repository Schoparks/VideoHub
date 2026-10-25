import { useLayoutEffect, useRef } from 'react';
import { ArrowLeft, Clock3, Ellipsis, Gamepad2, Library, Link, Search, SlidersHorizontal } from 'lucide-react';
import { navigation, type Route } from '../navigation';

export const phoneTools = [
  { id: 'library', label: '我的', Icon: Library },
  { id: 'settings', label: '设置', Icon: SlidersHorizontal },
  { id: 'remote', label: '按键', Icon: Gamepad2 },
  { id: 'link', label: '打开链接', Icon: Link },
] as const;
export type PhoneTool = typeof phoneTools[number]['id'] | 'history' | 'tools' | 'search';

export function PhoneToolbar({ player, online, ready, home, open, source, browse }: {
  player: boolean; online: boolean; ready: boolean; home: () => void;
  open: (tool: PhoneTool, opener: HTMLElement) => void;
  source: Route; browse: (source: Route) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const selected = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (selected && nav.current) nav.current.scrollTo({ left: selected.offsetLeft - nav.current.offsetLeft - 8 });
  }, [source, player]);
  return <header className="companion-header">
    <span className="phone-sr-only" role="status">{online ? '已连接电视' : '未连接'}</span>
    {player ? <div className="companion-brand"><button className="phone-home" aria-label="返回首页" title="返回首页" onClick={home}><ArrowLeft size={22} /></button></div>
      : <nav ref={nav} className="phone-sources" aria-label="主导航">
        {navigation.map(({ id, label }) => <button key={id} disabled={!ready}
          aria-current={source === id ? 'page' : undefined} onClick={() => browse(id)}>{label}</button>)}
      </nav>}
    <div className="companion-tools" aria-label="遥控工具">
      <button aria-label="打开搜索" title="搜索" aria-haspopup="dialog" disabled={!ready}
        onClick={event => open('search', event.currentTarget)}><Search size={21} /></button>
      <button aria-label="历史记录" title="历史记录" aria-haspopup="dialog" disabled={!ready}
        onClick={event => open('history', event.currentTarget)}><Clock3 size={20} /></button>
      <button aria-label="工具" title="工具" aria-haspopup="dialog" disabled={!ready}
        onClick={event => open('tools', event.currentTarget)}><Ellipsis size={23} /></button>
    </div>
  </header>;
}
