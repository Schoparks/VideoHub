import { useEffect, useRef, useState } from 'react';
import type { Folder, MediaDetail, MediaItem } from '../shared/types';
import { api, message } from '../api';
import type { CollectionChange } from '../shared/collection-change';

export function useMediaDetails(item: MediaItem, notify: (text: string) => void, isWatchLater: boolean, changed: (change: CollectionChange) => void) {
  const [detail, setDetail] = useState<MediaDetail>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [folders, setFolders] = useState<Folder[]>();
  const [folder, setFolder] = useState(0);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [watchLaterAdded, setWatchLaterAdded] = useState(isWatchLater);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const generation = useRef(0), busy = useRef(false), loadingFolders = useRef(false);
  useEffect(() => {
    const token = ++generation.current;
    setError(''); setDetail(undefined); setSelected(''); setFolders(undefined); setFoldersLoading(false); setSaving(false);
    setWatchLaterAdded(isWatchLater);
    busy.current = false; loadingFolders.current = false;
    void api.detail(item).then(detail => {
      if (token !== generation.current) return;
      setDetail(detail);
      setSelected(detail.parts.find(part => item.episodeId !== undefined && part.episodeId === item.episodeId || item.cid !== undefined && part.cid === item.cid)?.id || detail.parts[0]?.id || '');
    }).catch(error => { if (token === generation.current) setError(message(error)); });
    return () => { generation.current++; };
  }, [item.id, item.cid, item.episodeId, retry]);
  const current = detail?.item || item;
  const perform = async (run: () => Promise<void>, done: string) => {
    if (busy.current) return false;
    const token = generation.current;
    busy.current = true; setSaving(true);
    try {
      await run();
      if (token !== generation.current) return false;
      notify(done);
      return true;
    }
    catch (error) { if (token === generation.current) notify(message(error)); return false; }
    finally { if (token === generation.current) { busy.current = false; setSaving(false); } }
  };
  const loadFolders = async () => {
    if (loadingFolders.current) return;
    const token = generation.current;
    loadingFolders.current = true; setFoldersLoading(true);
    try {
      const folders = await api.folders();
      if (token === generation.current) { setFolders(folders); setFolder(folders[0]?.id || 0); }
    } catch (error) { if (token === generation.current) notify(message(error)); }
    finally { if (token === generation.current) { loadingFolders.current = false; setFoldersLoading(false); } }
  };
  return {
    detail, current, error, selected, setSelected, folders, folder, setFolder, saving, foldersLoading, watchLaterAdded,
    reload: () => setRetry(value => value + 1), loadFolders, closeFolders: () => setFolders(undefined),
    watchLater: async () => {
      const add = !watchLaterAdded;
      const saved = await perform(async () => {
        await api.watchLater(current, add);
        changed({ kind: 'watchlater', itemId: current.id, added: add });
      }, add ? '已加入 B 站稍后再看' : '已从 B 站稍后再看移除');
      if (saved) setWatchLaterAdded(add);
    },
    favorite: async (add: boolean) => {
      const saved = await perform(async () => {
        await api.favorite(current, folder, add);
        changed({ kind: 'favorites', itemId: current.id, folderId: folder, added: add });
      }, add ? '已收藏到 B 站' : '已从此收藏夹移除');
      if (saved) setFolders(undefined);
    },
    official: () => api.openOfficial(current).catch(error => notify(message(error))),
  };
}
