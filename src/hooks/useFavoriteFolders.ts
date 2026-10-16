import { useEffect, useRef, useState } from 'react';
import { api, message } from '../api';
import type { AccountStatus, Folder } from '../shared/types';

export function useFavoriteFolders(active: boolean, account: AccountStatus, accountRevision: number) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const pending = useRef(false);
  const owner = useRef('');
  const nextOwner = `${account.web}:${account.webMid || ''}:${accountRevision}`;
  const reload = async () => {
    if (!active || !account.web || pending.current) return;
    const token = ++request.current;
    pending.current = true;
    setLoading(true);
    try {
      const result = await api.folders();
      if (token !== request.current) return;
      setError('');
      setFolders(result);
      setFolder(current => result.some(folder => folder.id === current) ? current : result[0]?.id || 0);
      setLoaded(true);
    } catch (error) {
      if (token === request.current) setError(message(error));
    } finally {
      if (token === request.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    setLoading(false);
    if (owner.current !== nextOwner) {
      owner.current = nextOwner;
      setFolders([]);
      setFolder(0);
      setLoaded(false);
      setError('');
    }
    if (active && account.web) void reload();
    return () => {
      request.current++;
      pending.current = false;
    };
  }, [active, account.web, account.webMid, accountRevision]);

  return {
    folders: owner.current === nextOwner ? folders : [],
    folder: owner.current === nextOwner ? folder : 0,
    setFolder, error: active && owner.current === nextOwner ? error : '', reload,
    loading: active && account.web && (loading || !loaded && !error),
    empty: active && account.web && loaded && !loading && !error && !folders.length,
  };
}
