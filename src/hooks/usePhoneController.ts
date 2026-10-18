import { useEffect, useRef } from 'react';
import { api } from '../api';
import { parseControllerCommand, type ControllerReply, type ControllerRequest } from '../shared/remote-control';

interface Options {
  blocked: boolean;
  opening: boolean;
  search: (text: string) => void;
  open: (text: string) => Promise<ControllerReply>;
}

/** Receive named commands through the native bridge; all navigation stays in useInput. */
export function usePhoneController(options: Options) {
  const current = useRef(options);
  current.current = options;
  useEffect(() => {
    let active = true, textPending = false;
    const receive = async (request: ControllerRequest) => {
      if (!request || typeof request.id !== 'string') return;
      const command = parseControllerCommand(request.command);
      let reply: ControllerReply = {};
      let ownsText = false;
      try {
        if (!command || document.hidden) reply = { error: 'unavailable' };
        else if (command.kind === 'action') {
          const event = new CustomEvent('hub-controller-action', { detail: command.action, cancelable: true });
          if (window.dispatchEvent(event)) reply = { error: 'unavailable' };
        } else if (textPending || current.current.opening) reply = { error: 'busy' };
        else if (current.current.blocked) reply = { error: 'blocked' };
        else {
          textPending = true;
          ownsText = true;
          document.dispatchEvent(new CustomEvent('hub-input-action', { detail: 'search' }));
          if (command.kind === 'search') current.current.search(command.text);
          else reply = await current.current.open(command.text);
        }
      } catch { reply = { error: 'failed' }; }
      finally { if (ownsText) textPending = false; }
      if (active) await api.controllerReply?.(request.id, reply).catch(() => {});
    };
    const unsubscribe = api.onControllerCommand?.(request => { void receive(request); });
    return () => { active = false; unsubscribe?.(); };
  }, []);
}
