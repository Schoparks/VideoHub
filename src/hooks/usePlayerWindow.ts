import { useEffect, useRef, useState } from 'react';
import { api, message } from '../api';

export function usePlayerWindow(tvMode: boolean, notify: (text: string) => void) {
  const [fullscreen, setFullscreen] = useState(tvMode);
  const [busy, setBusy] = useState(true);
  const current = useRef(tvMode);
  const preferred = useRef(tvMode);
  const preferenceChanged = useRef(false);
  if (preferred.current !== tvMode) preferenceChanged.current = true;
  preferred.current = tvMode;
  const entry = useRef<boolean | undefined>(undefined);
  const initialized = useRef<Promise<void> | undefined>(undefined);
  const alive = useRef(true), revision = useRef(0), restoring = useRef(false);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const update = (value: boolean) => {
    revision.current++;
    current.current = value;
    if (alive.current) setFullscreen(value);
  };
  const read = async (fallback: boolean, capture = false) => {
    const token = revision.current;
    let value: boolean;
    try { value = api.getFullscreen ? await api.getFullscreen() : fallback; }
    catch (error) {
      if (alive.current && token === revision.current) throw error;
      return;
    }
    // The entry snapshot belongs to the read request, even if a newer event
    // already updated the button (for example a TV setting during this read).
    if (alive.current && capture && entry.current === undefined) entry.current = value;
    if (alive.current && token === revision.current) update(value);
  };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = api.onFullscreen?.(update);
    const token = revision.current;
    initialized.current = read(tvMode, true).catch(error => {
      if (alive.current && token === revision.current) notify(message(error));
    }).finally(() => {
      if (alive.current && !pending.current && !restoring.current) setBusy(false);
    });
    return () => { alive.current = false; revision.current++; unsubscribe?.(); };
  }, []);
  const toggle = async () => {
    if (pending.current || restoring.current || !alive.current) return;
    setBusy(true);
    pending.current = (async () => {
      await initialized.current;
      if (!alive.current || restoring.current) return;
      if (entry.current === undefined) await read(current.current, true);
      if (entry.current === undefined || !alive.current || restoring.current) return;
      const next = !current.current;
      await api.fullscreen(next);
      await read(next);
    })()
      .catch(error => { if (alive.current && !restoring.current) notify(message(error)); });
    await pending.current;
    pending.current = undefined;
    if (alive.current && !restoring.current) setBusy(false);
  };
  const restore = async () => {
    restoring.current = true;
    setBusy(true);
    await initialized.current;
    await pending.current;
    // A player toggle is temporary. Only an explicit TV preference edit during
    // playback replaces the actual window state captured on entry.
    const target = preferenceChanged.current ? preferred.current : entry.current;
    if (target !== undefined && current.current !== target) {
      await api.fullscreen(target).then(() => read(target))
        .catch(error => { if (alive.current) notify(message(error)); });
    }
  };
  return { fullscreen, busy, toggle, restore };
}
