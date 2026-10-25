import { useCallback, useEffect, useRef, useState } from 'react';
import type { ControllerCommand } from '../shared/remote-control';
import type { CompanionState } from '../shared/companion';
import { checkConnection, connectionError, sendCommand } from './connection';

export function useCompanionConnection() {
  const [state, setState] = useState<CompanionState>();
  const [online, setOnline] = useState(false);
  const [error, setError] = useState('');
  const checking = useRef(false), alive = useRef(true), generation = useRef(0);
  const refresh = useCallback(async () => {
    if (checking.current || document.hidden) return;
    checking.current = true;
    const token = generation.current;
    try {
      await checkConnection();
      const reply = await sendCommand({ kind: 'snapshot' });
      if (alive.current && token === generation.current) {
        setState(reply.state); setOnline(true); setError('');
      }
    } catch (failure) {
      if (alive.current && token === generation.current) { setOnline(false); setError(connectionError(failure)); }
    } finally { checking.current = false; }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 1500);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('hashchange', refresh);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('hashchange', refresh);
    };
  }, [refresh]);
  const send = useCallback(async (command: ControllerCommand) => {
    const changesState = !['catalog', 'folders', 'related', 'cover', 'snapshot'].includes(command.kind);
    if (changesState) generation.current++;
    const reply = await sendCommand(command);
    if (alive.current) {
      if (reply.state) setState(reply.state);
      if (changesState) void refresh();
    }
    return reply;
  }, [refresh]);
  return { state, online, error, refresh, send };
}
