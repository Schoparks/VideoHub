import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { type Bootstrap, type MediaItem } from './shared/types';
import { type Route, type Dialog } from './navigation';
import { useInput } from './input/use-input';
import { useTextEntry } from './input/use-text-entry';
import { TextEntry } from './components/TextEntry';
import { useBrowseFeed } from './hooks/useBrowseFeed';
import { usePlayback } from './hooks/usePlayback';
import { useBootstrap } from './hooks/useBootstrap';
import { useQueueActions } from './hooks/useQueueActions';
import { usePreferences } from './hooks/usePreferences';
import { useLibraryActions } from './hooks/useLibraryActions';
import { browseNavigationAction } from './input/browse-navigation-actions';
import { useBrowseFocus } from './input/use-browse-focus';
import { moveBrowsePage } from './input/browse-page';
import { AppShell } from './components/AppShell';
import { AppDialogs } from './components/AppDialogs';
import { BrowseContent } from './components/BrowseContent';
import { FeedResults } from './components/FeedResults';
import { QueueList } from './components/QueueList';
import { Player, type PlayerHandle } from './components/Player';
import { PlaybackPreparation } from './components/PlaybackPreparation';
import { LibraryFeedback } from './components/LibraryFeedback';
import { GlassOptics } from './components/GlassOptics';
import { usePhoneController } from './hooks/usePhoneController';

export default function App() {
  const preferencePending = useRef<() => boolean>(() => false);
  const { boot, setBoot, ready, error: bootError, bootstrap } = useBootstrap(() => preferencePending.current());
  const [route, setRoute] = useState<Route>('home');
  const [tab, setTab] = useState('recommend');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<MediaItem>();
  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const main = useRef<HTMLElement>(null);
  const player = useRef<PlayerHandle>(null);
  const scroll = useRef(new Map<string, number>());
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusedCard = useRef<HTMLElement | null>(null);
  const { entry, closeEntry } = useTextEntry(() => setDialog('search'));

  const notify = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const preferenceActions = usePreferences(boot.preferences, value => setBoot(boot => ({ ...boot, preferences: value })), notify);
  preferencePending.current = preferenceActions.isPending;
  const changePreferences = preferenceActions.change;
  const queueActions = useQueueActions(boot.queue, queue => setBoot(boot => ({ ...boot, queue })), notify);

  const navigate = (next: Route, nextTab?: string) => {
    scroll.current.set(`${route}:${tab}`, main.current?.scrollTop || 0);
    setRoute(next);
    setTab(nextTab || (next === 'mine' ? 'watchlater' : next === 'live' ? 'followingLive' : next === 'cinema' ? 'cinema' : 'recommend'));
    setError('');
  };
  useEffect(() => {
    document.documentElement.dataset.theme = boot.preferences.theme;
    document.documentElement.dataset.tv = String(boot.preferences.tvMode);
    document.documentElement.dataset.cardColumns = String(boot.preferences.cardColumns || 0);
    document.documentElement.style.setProperty('--card-columns', String(boot.preferences.cardColumns || 0));
  }, [boot.preferences]);

  const { source, opening, play, openPlayback, closePlayer, next, nextKind, cancelOpening, cancelPending, canCancelOpening } = usePlayback({
    dialog,
    closeDialog: () => setDialog(null),
    queue: boot.queue,
    bootstrap,
    notify,
    focusedCard,
  });
  const focusBrowse = useBrowseFocus(`${route}:${tab}`, main, !!source || !!dialog || !!entry);
  const device = useInput(boot.preferences, action => {
    if (document.querySelector('[data-calibrating="true"]')) return true;
    if (entry) {
      if (action === 'back') { closeEntry(); return true; }
      return ['menu', 'previous', 'next', 'search', 'details', 'pause', 'rewind', 'forward'].includes(action);
    }
    if (action === 'back' && cancelOpening()) return true;
    if (dialog) {
      if (action === 'back') {
        const collapse = document.querySelector<HTMLButtonElement>('[data-back-action]');
        if (collapse) { collapse.click(); return true; }
        setDialog(null);
        return true;
      }
      return ['menu', 'previous', 'next', 'search', 'details', 'pause', 'rewind', 'forward'].includes(action);
    }
    if (source) return player.current?.action(action);
    if (action === 'menu') {
      const detail = document.activeElement?.closest('.media-card-wrap')?.querySelector<HTMLButtonElement>('.card-details');
      if (detail) detail.click();
      else setDialog('settings');
      return true;
    }
    if (action === 'rewind' || action === 'forward') {
      moveBrowsePage(main.current, action === 'rewind' ? -1 : 1);
      return true;
    }
    if (action === 'pause') return true;
    if (action === 'back') {
      if (browseNavigationAction('back')) return true;
      if (document.documentElement.dataset.inputMode === 'remote' && document.activeElement?.closest('.topbar')) {
        if (route === 'home') window.hubRemoteExit?.();
        else navigate('home');
      }
      return true;
    }
    if (action === 'search') {
      setDialog('search');
      return true;
    }
    if (action === 'details') {
      const active = document.activeElement as HTMLElement;
      const detailButton = active?.closest('.media-card-wrap')?.querySelector<HTMLButtonElement>('.card-details');
      if (detailButton) {
        detailButton.click();
        return true;
      }
      const id = active?.dataset.mediaId;
      const item = [...feed.data.items, ...boot.library, ...boot.history.map(history => history.item)]
        .find(item => item.id === id);
      if (item) open(item);
      return true;
    }
    if (action === 'next' || action === 'previous') {
      return browseNavigationAction(action);
    }
  });
  const feed = useBrowseFeed({
    route, tab, keyword, ready, account: boot.account, source, opening, dialog, error, setError, main, scroll,
  });
  const libraryVisible = (route === 'home' || route === 'local') && !source && !dialog && !entry;
  const library = useLibraryActions({
    view: `${route}:${tab}:${source?.sessionId || ''}:${dialog || ''}:${!!entry}`,
    visible: libraryVisible,
    changed: library => setBoot(boot => ({ ...boot, library })),
    imported: () => navigate('local'),
    notify,
  });
  const libraryFeedback = <LibraryFeedback busy={library.busy} error={library.error} retry={() => void library.retry()} />;

  const open = (item: MediaItem) => {
    focusedCard.current = document.activeElement as HTMLElement;
    setSelected(item);
    setDialog('details');
  };
  const accountChanged = (account: Bootstrap['account']) => {
    feed.resetAccount();
    setBoot(boot => ({ ...boot, account }));
  };
  const search = (value = query) => {
    if (!value.trim()) return;
    if (route !== 'search' || value.trim() !== keyword) feed.setSearchType('all');
    setQuery(value);
    setKeyword(value.trim());
    focusBrowse('search:recommend');
    navigate('search');
    setDialog(null);
  };
  usePhoneController({
    blocked: !ready || !!source || !!dialog || !!entry,
    opening,
    search,
    open: async value => {
      const result = await openPlayback(() => api.openUrl(value));
      return result === 'opened' ? {} : { error: result };
    },
  });
  const queue = (
    <QueueList items={boot.queue} busy={queueActions.busy} play={item => void play(item)} update={items => void queueActions.update(items)} />
  );
  const results = (
    <FeedResults
      kind={feed.kind} data={feed.data} account={boot.account} loading={feed.loading} error={feed.error} retrying={feed.retrying}
      readyForFocus={feed.readyForFocus}
      emptyTitle={feed.emptyTitle}
      connect={() => setDialog('account')} retry={() => {
        if (!feed.data.items.length && !feed.data.dynamics?.length) focusBrowse(`${route}:${tab}`);
        void feed.retry();
      }}
      play={item => void play(item)} details={open}
    />
  );

  return (
    <>
      <GlassOptics />
      <AppShell
        boot={boot} route={route} device={device} query={query} keyword={keyword} opening={opening}
        libraryBusy={!!library.busy}
        blocked={!!source || !!dialog || !!entry}
        ready={ready} error={bootError} retry={() => void bootstrap()}
        mainRef={main} navigate={navigate} dialog={setDialog} setQuery={setQuery} search={search}
        toggleTv={() => void changePreferences({ ...boot.preferences, tvMode: !boot.preferences.tvMode })}
        addFile={() => void library.add(false)}
      >
        <BrowseContent
          route={route} tab={tab} boot={boot} loading={feed.loading} opening={opening} canLoad={feed.canLoad}
          libraryBusy={library.busy} libraryFeedback={libraryFeedback}
          keyword={keyword} dynamicType={feed.dynamicType} region={feed.region} cinema={feed.cinema}
          folder={feed.folder} folders={feed.folders} results={results} queue={queue} setTab={setTab}
          setDynamicType={feed.setDynamicType} setRegion={feed.setRegion} setCinema={feed.setCinema}
          searchType={feed.searchType} setSearchType={feed.setSearchType}
          setFolder={feed.setFolder} navigate={navigate} refresh={() => void feed.load(true)}
          addDirectory={() => void library.add(true)} play={(item, part) => void play(item, part)}
          details={open} rescan={() => void library.rescan()}
        />
      </AppShell>
      {source && (
        <Player
          ref={player} source={source} preferences={boot.preferences} close={() => void closePlayer()}
          cancelPending={cancelPending}
          settings={() => setDialog('settings')}
          toggleDanmaku={() => void changePreferences({ ...boot.preferences, danmaku: !boot.preferences.danmaku })}
          blocked={!!dialog || !!entry}
          next={next} nextKind={nextKind} queue={() => setDialog('queue')} episode={part => play(source.item, part, source.quality)}
          quality={(quality, position) => play(source.item, source.part, quality, position)} notify={notify}
          reload={position => play(source.item, source.part, source.quality, position)}
        />
      )}
      {dialog && (
        <AppDialogs
          key={dialog}
          dialog={dialog} boot={boot} selected={selected} opening={opening} device={device}
          queueBusy={queueActions.busy}
          isWatchLater={selected ? feed.watchLaterState(selected.id) ?? (route === 'mine' && tab === 'watchlater') : false}
          queue={queue} query={query} url={url}
          close={() => { cancelOpening(); setDialog(null); }} setQuery={setQuery} setUrl={setUrl} search={search}
          openUrl={failure => play(() => api.openUrl(url), undefined, undefined, undefined, failure)} accountChanged={accountChanged}
          preferencesChanged={value => void changePreferences(value)} play={(item, part) => void play(item, part)}
          enqueue={item => void queueActions.enqueue(item)} notify={notify}
          collectionChanged={feed.collectionChanged}
        />
      )}
      {entry && <TextEntry input={entry} close={closeEntry} />}
      {opening && <PlaybackPreparation cancel={canCancelOpening ? () => { cancelOpening(); } : undefined} />}
      {library.busy && !libraryVisible && !source && !dialog && !entry && !opening && (
        <LibraryFeedback busy={library.busy} error="" retry={() => {}} compact />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
