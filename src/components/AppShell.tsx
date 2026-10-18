import type { ReactNode, Ref } from 'react';
import { Gamepad2, Link, Monitor, Play, Plus, Search, RefreshCw } from 'lucide-react';
import type { Bootstrap } from '../shared/types';
import { navigation, type Dialog, type Route } from '../navigation';
import { CoverImage } from './CoverImage';
import { useImeGuard } from '../input/use-ime-guard';
import { LibraryButton } from './LibraryButton';
import { TopNavigation } from './TopNavigation';

interface Props {
  boot: Bootstrap;
  route: Route;
  device: string;
  query: string;
  keyword: string;
  opening: boolean;
  libraryBusy: boolean;
  blocked: boolean;
  ready: boolean;
  error: string;
  retry: () => void;
  mainRef: Ref<HTMLElement>;
  children: ReactNode;
  navigate: (route: Route) => void;
  dialog: (dialog: Dialog) => void;
  setQuery: (value: string) => void;
  search: () => void;
  toggleTv: () => void;
  addFile: () => void;
}

export function AppShell(props: Props) {
  const ime = useImeGuard();
  const { boot, route, device, query, keyword, opening, navigate, dialog } = props;
  const title = route === 'search' ? `搜索：${keyword}` : navigation.find(item => item.id === route)!.label;
  return (
    <div className="app-shell" inert={props.blocked}>
      <div className="workspace">
        <header className="topbar">
          <div className="brand" aria-label="映集">
            <span className="brand-mark"><Play size={20} fill="currentColor" /></span>
            <span>映集<small>YINGJI</small></span>
          </div>
          {device && (
            <div className="controller-status connected" title={device}>
              <Gamepad2 size={21} /><b>手柄已连接</b><i />
            </div>
          )}
          <form className="global-search" onSubmit={event => { event.preventDefault(); if (!ime.pending()) props.search(); }}>
            <Search size={19} />
            <input
              aria-label="搜索视频" placeholder="搜索视频" value={query} data-gamepad-search
              onChange={event => props.setQuery(event.target.value)}
              onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd}
              onKeyDown={event => {
                ime.onKeyDown(event);
                if (event.key === 'Enter' && !query.trim() && !event.defaultPrevented && !ime.pending()) {
                  event.preventDefault();
                  dialog('search');
                }
              }}
            />
          </form>
          <button
            className="icon-button tv-button" title="电视模式" aria-label="切换电视模式"
            aria-pressed={boot.preferences.tvMode} onClick={props.toggleTv}
          >
            <Monitor size={21} />
          </button>
          <button className="profile" onClick={() => dialog('account')} aria-label="管理 B 站账号">
            {boot.account.avatar ? <CoverImage src={boot.account.avatar} alt="" artworkSize={160} /> : <span>映</span>}
            <i className={boot.account.app && boot.account.web ? 'online' : ''} />
          </button>
          <TopNavigation route={route} navigate={navigate} settings={() => dialog('settings')} />
        </header>
        <main tabIndex={-1} aria-label={title} ref={props.mainRef}>
          <div className="page-top">
            <h1 title={title}>{title}</h1>
            <div className="page-actions">
              <button onClick={() => dialog('url')}><Link size={17} />打开链接</button>
              <LibraryButton blocked={opening} busy={props.libraryBusy} action={props.addFile}>
                <Plus size={18} />打开文件
              </LibraryButton>
            </div>
          </div>
          {boot.preview && <div className="preview-notice"><Monitor size={16} />账号、播放与本地片库需在桌面应用中使用。</div>}
          {boot.notice && <p className="notice">{boot.notice}</p>}
          {props.error && (
            <div className="inline-error" role="alert">
              <span>{props.error}</span><button onClick={props.retry}><RefreshCw size={16} />重试</button>
            </div>
          )}
          {props.ready ? props.children : !props.error && (
            <div className="loading" role="status"><RefreshCw className="spin" />正在加载…</div>
          )}
        </main>
        <footer className="input-hints" aria-label="快捷操作" data-input-hints-host />
      </div>
    </div>
  );
}
