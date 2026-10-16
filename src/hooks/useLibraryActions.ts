import { useEffect, useRef, useState } from 'react';
import { api, message } from '../api';
import type { MediaItem } from '../shared/types';

export type LibraryOperation = 'files' | 'directory' | 'rescan';
interface Options {
  view: string;
  visible: boolean;
  changed: (items: MediaItem[]) => void;
  imported: () => void;
  notify: (text: string) => void;
}

export function useLibraryActions(options: Options) {
  const [busy, setBusy] = useState<LibraryOperation>();
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);
  const current = useRef(options);
  const lastOperation = useRef<LibraryOperation>('rescan');
  const view = useRef({ key: options.view, revision: 0 });
  if (view.current.key !== options.view) view.current = { key: options.view, revision: view.current.revision + 1 };
  current.current = options;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async (operation: LibraryOperation) => {
    if (pending.current) return;
    pending.current = true;
    if (operation !== lastOperation.current) setError('');
    lastOperation.current = operation;
    const origin = view.current.revision;
    setBusy(operation);
    try {
      if (operation === 'rescan') {
        const library = await api.rescan();
        if (mounted.current) {
          setError('');
          current.current.changed(library);
        }
      } else {
        const result = await api.addLocal(operation === 'directory');
        if (!mounted.current || result.canceled) return;
        current.current.changed(result.library);
        if (!result.found) {
          setError('所选位置没有支持的媒体文件');
          if (!current.current.visible) current.current.notify('所选位置没有支持的媒体文件');
        } else {
          setError('');
          if (origin === view.current.revision) current.current.imported();
          current.current.notify(result.added ? `已添加 ${result.added} 个媒体文件` : '所选媒体已在片库中');
        }
      }
    } catch (error) {
      if (mounted.current) {
        setError(message(error));
        if (!current.current.visible) current.current.notify(message(error));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(undefined);
    }
  };
  return { busy, error, add: (directory: boolean) => run(directory ? 'directory' : 'files'),
    rescan: () => run('rescan'), retry: () => run(lastOperation.current) };
}
