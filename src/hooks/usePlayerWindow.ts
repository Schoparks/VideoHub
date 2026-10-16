import { useEffect, useRef, useState } from 'react';
import { api, message } from '../api';

export function usePlayerWindow(tvMode: boolean, notify: (text: string) => void) {
  const [fullscreen, setFullscreen] = useState(tvMode);
  const [busy, setBusy] = useState(false);
  const current = useRef(tvMode);
  const preferred = useRef(tvMode);
  preferred.current = tvMode;
  const alive = useRef(true), revision = useRef(0), restoring = useRef(false);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const update = (value: boolean) => {
    revision.current++;
    current.current = value;
    if (alive.current) setFullscreen(value);
  };
  const read = async (fallback: boolean) => {
    const token = revision.current;
    let value: boolean;
    try { value = api.getFullscreen ? await api.getFullscreen() : fallback; }
    catch (error) {
      if (alive.current && token === revision.current) throw error;
      return;
    }
    if (alive.current && token === revision.current) update(value);
  };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = api.onFullscreen?.(update);
    const token = revision.current;
    void read(tvMode).catch(error => {
      if (alive.current && token === revision.current) notify(message(error));
    });
    return () => { alive.current = false; revision.current++; unsubscribe?.(); };
  }, []);
  const toggle = async () => {
    if (pending.current || restoring.current || !alive.current) return;
    const next = !current.current;
    setBusy(true);
    pending.current = api.fullscreen(next).then(() => read(next))
      .catch(error => { if (alive.current && !restoring.current) notify(message(error)); });
    await pending.current;
    pending.current = undefined;
    if (alive.current && !restoring.current) setBusy(false);
  };
  const restore = async () => {
    restoring.current = true;
    setBusy(true);
    await pending.current;
    if (current.current !== preferred.current) {
      await api.fullscreen(preferred.current).then(() => read(preferred.current))
        .catch(error => { if (alive.current) notify(message(error)); });
    }
  };
  return { fullscreen, busy, toggle, restore };
}
