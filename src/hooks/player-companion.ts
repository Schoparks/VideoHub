import type { CompanionPlayer, PlayerCommand } from '../shared/companion';
import type { ControllerReply } from '../shared/remote-control';
import type { PlaybackOpenResult } from '../shared/types';

export interface CompanionPlayerHandle {
  snapshot(): CompanionPlayer;
  control(session: string, command: PlayerCommand): Promise<ControllerReply>;
  replace(run: () => Promise<ControllerReply>): Promise<ControllerReply>;
}
interface Options {
  state: CompanionPlayer;
  blocked: () => boolean;
  toggle: () => void;
  previous: () => void;
  next: () => Promise<ControllerReply>;
  stop: () => Promise<void>;
  retry: () => Promise<ControllerReply>;
  seek: (value: number) => void;
  rate: (value: number) => void;
  quality: (value: number) => Promise<ControllerReply>;
  episode: (id: string) => Promise<ControllerReply>;
  transition: (run: () => Promise<void>) => Promise<void>;
}

/** Direct phone controls use the same media intent and serialized transitions as TV controls. */
export function playerCompanion(options: Options): CompanionPlayerHandle {
  const { state } = options;
  return {
    snapshot: () => ({ ...state, busy: options.blocked() }),
    replace: async run => {
      if (options.blocked()) return { error: 'busy' };
      let result: ControllerReply = { error: 'canceled' };
      await options.transition(async () => { result = await run(); });
      return result;
    },
    control: async (session, command) => {
      if (session !== state.session) return { error: 'canceled' };
      if (options.blocked()) return { error: 'busy' };
      if (command.operation === 'stop') { await options.stop(); return {}; }
      if (command.operation === 'quality') {
        if (!state.qualities.some(value => value.id === command.value)) return { error: 'unavailable' };
        return options.quality(command.value);
      }
      if (command.operation === 'retry') return options.retry();
      if (state.error) return { error: 'failed' };
      switch (command.operation) {
        case 'toggle': options.toggle(); break;
        case 'previous':
          if (state.live) return { error: 'unavailable' };
          if (state.parts.findIndex(part => part.id === state.part) > 0) {
            return options.episode(state.parts[state.parts.findIndex(part => part.id === state.part) - 1].id);
          }
          options.previous(); break;
        case 'next':
          if (!state.next) return { error: 'unavailable' };
          return options.next();
        case 'rate':
          if (state.live) return { error: 'unavailable' };
          options.rate(command.value); break;
        case 'seek':
          if (state.live || !state.duration || state.loading || command.value > state.duration) return { error: 'unavailable' };
          options.seek(command.value); break;
        case 'episode':
          if (!state.parts.some(part => part.id === command.value)) return { error: 'unavailable' };
          return options.episode(command.value);
      }
      return {};
    },
  };
}

export async function companionTransition(
  transition: (run: () => Promise<void>) => Promise<void>,
  run: () => Promise<PlaybackOpenResult>,
): Promise<ControllerReply> {
  let result: ControllerReply = { error: 'canceled' };
  await transition(async () => {
    const status = await run();
    result = status === 'opened' ? {} : { error: status };
  });
  return result;
}
