import { useCallback, useEffect, useRef, useState } from 'react';
import { api, message } from '../api';
import { defaultPreferences, type Bootstrap } from '../shared/types';

const initial: Bootstrap = {
  account: { app: false, web: false, storage: 'memory' },
  library: [], history: [], queue: [], preferences: defaultPreferences,
  version: '0.1.0', platform: '',
};

export function useBootstrap(retainPreferences?: () => boolean) {
  const [boot, setBoot] = useState(initial);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(boot);
  const active = useRef(false);
  const revision = useRef(0);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const preferenceGuard = useRef(retainPreferences);
  preferenceGuard.current = retainPreferences;
  current.current = boot;
  const bootstrap = useCallback(() => {
    if (pending.current) return pending.current;
    const token = ++revision.current;
    const before = current.current;
    const retainAtStart = !!preferenceGuard.current?.();
    setError('');
    const job = (async () => {
      try {
        const result = await api.bootstrap();
        if (!active.current || token !== revision.current) return;
        setBoot(latest => ({
          ...result,
          account: latest.account === before.account ? result.account : latest.account,
          preferences: retainAtStart || preferenceGuard.current?.() || latest.preferences !== before.preferences
            ? latest.preferences : result.preferences,
          queue: latest.queue === before.queue ? result.queue : latest.queue,
          library: latest.library === before.library ? result.library : latest.library,
          history: latest.history === before.history ? result.history : latest.history,
        }));
        setReady(true);
      } catch (error) {
        if (active.current && token === revision.current) setError(message(error));
      } finally {
        if (token === revision.current) pending.current = undefined;
      }
    })();
    pending.current = job;
    return job;
  }, []);
  useEffect(() => {
    active.current = true;
    void bootstrap();
    return () => {
      active.current = false;
      revision.current++;
      pending.current = undefined;
    };
  }, [bootstrap]);
  return { boot, setBoot, ready, error, bootstrap };
}
