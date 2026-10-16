import { useEffect, useRef, useState, type RefObject } from 'react';
import { api, message } from '../api';
import type { Bootstrap, BrowseKind, BrowseRequest, Page, PlaybackSource, SearchType } from '../shared/types';
import type { Dialog, Route } from '../navigation';
import { mergeBrowsePage, type BrowsePaginationProgress } from './browsePagination';
import { useFavoriteFolders } from './useFavoriteFolders';
import type { CollectionChange } from '../shared/collection-change';
import { refreshFavorites } from './refreshFavorites';

interface BrowseFeedOptions {
  route: Route;
  tab: string;
  keyword: string;
  ready: boolean;
  account: Bootstrap['account'];
  source?: PlaybackSource;
  opening: boolean;
  dialog: Dialog;
  error: string;
  setError: (error: string) => void;
  main: RefObject<HTMLElement | null>;
  scroll: RefObject<Map<string, number>>;
}

export function useBrowseFeed(options: BrowseFeedOptions) {
  const { route, tab, keyword, ready, account, source, opening, dialog, error, setError, main, scroll } = options;
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Page>({ items: [], hasMore: false });
  const [region, setRegion] = useState(4);
  const [cinema, setCinema] = useState(2);
  const [dynamicType, setDynamicType] = useState<'all' | 'video'>('all');
  const [searchType, setSearchType] = useState<SearchType>('all');
  const [accountRevision, setAccountRevision] = useState(0);
  const [collectionRevision, setCollectionRevision] = useState(0);
  const dirtyCollections = useRef(new Set<string>());
  const knownWatchLater = useRef(new Map<string, boolean>());
  const [pageVisible, setPageVisible] = useState(document.visibilityState === 'visible');
  const requestBusy = useRef(false);
  const recommendationTarget = useRef(30);
  const cache = useRef(new Map<string, Page>());
  const cachedPages = useRef(new Map<string, number>());
  const pagination = useRef(new Map<string, BrowsePaginationProgress>());
  const failedLoad = useRef<{ refresh: boolean; more: boolean; continuation: boolean; message: string } | undefined>(undefined);
  const request = useRef(0);
  const page = useRef(1);

  useEffect(() => {
    const changed = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);

  const kind: BrowseKind | undefined = route === 'home' ? 'recommend'
    : route === 'bilibili' ? (tab === 'regions' ? 'regions' : tab === 'dynamic' ? 'dynamic' : 'recommend')
    : route === 'live' ? 'followingLive'
    : route === 'cinema' ? tab as BrowseKind
    : route === 'search' ? 'search'
    : route === 'mine' && ['history', 'favorites', 'watchlater'].includes(tab) ? tab as BrowseKind
    : undefined;
  const favoriteFolders = useFavoriteFolders(kind === 'favorites', account, accountRevision);
  const { folders, folder, setFolder } = favoriteFolders;
  const filter = kind === 'dynamic' ? dynamicType
    : kind === 'favorites' ? folder
    : kind === 'regions' ? region
    : kind === 'cinema' || kind === 'followingCinema' ? cinema
    : kind === 'search' ? `${searchType}:${keyword}` : '';
  const cacheKey = `${kind}:${filter}`;
  const ownerKey = `${account.webMid || ''}:${account.appMid || ''}:${accountRevision}`;
  const currentFeed = useRef({ cacheKey, ownerKey });
  currentFeed.current = { cacheKey, ownerKey };
  const canLoad = ready && !!kind && (kind !== 'recommend' || account.app)
    && (!['dynamic', 'history', 'favorites', 'watchlater', 'followingLive', 'followingCinema'].includes(kind) || account.web)
    && (kind !== 'favorites' || !!folder && !favoriteFolders.loading && !favoriteFolders.error);

  const load = async (refresh = false, more = false, continuation = false) => {
    if (!canLoad || !kind || requestBusy.current) return;
    requestBusy.current = true;
    const token = ++request.current;
    setLoading(true);
    setError('');
    if (kind === 'recommend' && !continuation) {
      recommendationTarget.current = (more ? data.items.length : 0) + 30;
    }
    if (kind === 'recommend' && refresh) {
      cache.current.delete(cacheKey);
      cachedPages.current.delete(cacheKey);
      setData({ items: [], hasMore: false });
      if (main.current) main.current.scrollTop = 0;
    }
    try {
      const args: BrowseRequest = {
        kind,
        refresh,
        page: more ? page.current + 1 : 1,
        cursor: more ? data.cursor : undefined,
        id: kind === 'favorites' ? folder
          : kind === 'regions' ? region
          : kind === 'followingCinema' ? cinema === 1 ? 1 : 2 : cinema,
        keyword,
        dynamicType: kind === 'dynamic' ? dynamicType : undefined,
        searchType: kind === 'search' ? searchType : undefined,
      };
      const refreshed = kind === 'favorites' && refresh && dirtyCollections.current.has(cacheKey)
        ? await refreshFavorites(api.browse, args, cachedPages.current.get(cacheKey) || 1, () => token === request.current)
        : undefined;
      if (token !== request.current) return;
      const result = refreshed?.data || await api.browse(args);
      if (token !== request.current) return;
      let next = result;
      if (refreshed) pagination.current.set(cacheKey, refreshed.progress);
      else if (kind !== 'recommend') {
        const merged = mergeBrowsePage(kind, more ? data : undefined, result, pagination.current.get(cacheKey));
        next = merged.data;
        pagination.current.set(cacheKey, merged.progress);
      }
      failedLoad.current = undefined;
      page.current = refreshed?.page || (more ? page.current + 1 : 1);
      cachedPages.current.set(cacheKey, page.current);
      cache.current.set(cacheKey, next);
      if (kind === 'watchlater') {
        if (result.hasMore === false) {
          const present = new Set(next.items.map(item => item.id));
          for (const id of knownWatchLater.current.keys()) {
            if (!present.has(id)) knownWatchLater.current.set(id, false);
          }
        }
        for (const item of next.items) knownWatchLater.current.set(item.id, true);
      }
      dirtyCollections.current.delete(cacheKey);
      setData(next);
    } catch (error) {
      if (token === request.current) {
        const text = message(error);
        failedLoad.current = { refresh, more, continuation, message: text };
        setError(text);
      }
    } finally {
      if (token === request.current) {
        requestBusy.current = false;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    request.current++;
    requestBusy.current = false;
    setLoading(false);
    setError('');
    failedLoad.current = undefined;
    page.current = cachedPages.current.get(cacheKey) || 1;
    const existing = cache.current.get(cacheKey);
    setData(existing || { items: [], hasMore: false });
    if (!existing && canLoad) void load(dirtyCollections.current.has(cacheKey));
    if (main.current) main.current.scrollTop = scroll.current.get(`${route}:${tab}`) || 0;
    return () => {
      request.current++;
      requestBusy.current = false;
    };
  }, [cacheKey, canLoad, account.appMid, account.webMid, accountRevision]);

  // A confirmed collection write refreshes its own feed when the overlay closes.
  // Retain existing content and never invalidate recommendation/search sessions.
  useEffect(() => {
    if (!dialog && !source && !opening && pageVisible && canLoad && dirtyCollections.current.has(cacheKey)) {
      void load(true);
    }
  }, [collectionRevision, cacheKey, canLoad, dialog, source, opening, pageVisible]);

  const collectionChanged = (change: CollectionChange) => {
    if (ownerKey !== currentFeed.current.ownerKey) return;
    const key = `${change.kind}:${change.kind === 'favorites' ? change.folderId || 0 : ''}`;
    dirtyCollections.current.add(key);
    if (change.kind === 'watchlater') knownWatchLater.current.set(change.itemId, change.added);
    const previous = cache.current.get(key);
    const next = previous && !change.added
      ? { ...previous, items: previous.items.filter(item => item.id !== change.itemId) } : previous;
    if (next) cache.current.set(key, next);
    if (key === currentFeed.current.cacheKey) {
      request.current++;
      requestBusy.current = false;
      setLoading(false);
      if (next) setData(next);
    }
    setCollectionRevision(value => value + 1);
  };

  // All feeds prefetch one viewport ahead; only recommendations use 30-item rounds.
  useEffect(() => {
    const viewport = main.current;
    if (!canLoad || loading || error || source || opening || dialog || !pageVisible
      || !data.hasMore || !viewport || cache.current.get(cacheKey) !== data) return;
    const check = () => {
      if (requestBusy.current || document.visibilityState !== 'visible') return;
      if (kind === 'recommend' && (data.items.length < recommendationTarget.current || viewport.scrollHeight <= viewport.clientHeight)) {
        void load(false, true, true);
      } else if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= viewport.clientHeight) {
        void load(false, true);
      }
    };
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(check, 100);
    };
    const frame = requestAnimationFrame(check);
    viewport.addEventListener('scroll', onScroll);
    viewport.addEventListener('focusin', onScroll);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('focusin', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [kind, canLoad, loading, error, source, opening, dialog, pageVisible, data, route]);

  const resetAccount = () => {
    currentFeed.current.ownerKey = '';
    request.current++;
    cache.current.clear();
    cachedPages.current.clear();
    pagination.current.clear();
    dirtyCollections.current.clear();
    knownWatchLater.current.clear();
    failedLoad.current = undefined;
    setLoading(false);
    setData({ items: [], hasMore: false });
    setAccountRevision(value => value + 1);
  };

  const retry = () => {
    if (favoriteFolders.error) return favoriteFolders.reload();
    const failed = failedLoad.current;
    return failed ? load(failed.refresh, failed.more, failed.continuation) : load(true);
  };

  return {
    kind, canLoad, loading: loading || favoriteFolders.loading, data, load, retry, resetAccount, collectionChanged,
    error: favoriteFolders.error || error,
    retrying: loading ? failedLoad.current?.message || '' : '',
    readyForFocus: !loading && !favoriteFolders.loading
      && (!canLoad || cache.current.get(cacheKey) === data || !!error),
    emptyTitle: favoriteFolders.empty ? '暂无收藏夹' : undefined,
    folders, folder, setFolder, region, setRegion, cinema, setCinema, dynamicType, setDynamicType,
    searchType, setSearchType,
    watchLaterState: (id: string) => knownWatchLater.current.get(id),
  };
}
