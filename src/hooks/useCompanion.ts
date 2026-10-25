import { useRef } from 'react';
import { api } from '../api';
import { phonePreferences, type CompanionCommand } from '../shared/companion';
import type { ControllerReply } from '../shared/remote-control';
import type { Bootstrap, MediaItem, PlaybackSource, Preferences } from '../shared/types';
import type { CompanionPlayerHandle } from './player-companion';
import { CompanionCatalog } from './companion-catalog';
import { CompanionLibrary } from './companion-library';
import { editCompanionQueue } from './companion-queue';
import type { CollectionChange } from '../shared/collection-change';

interface Options {
  boot: Bootstrap;
  ready: boolean;
  blocked: boolean;
  accountScreen: boolean;
  login: (operation: 'app' | 'web' | 'close') => void;
  queue: (items: MediaItem[]) => Promise<boolean>;
  collectionChanged: (change: CollectionChange) => void;
  opening: boolean;
  source?: PlaybackSource;
  player: { current: CompanionPlayerHandle | null };
  change: (preferences: Preferences) => Promise<boolean>;
  play: (item: MediaItem | (() => Promise<MediaItem>)) => Promise<ControllerReply>;
}

export function useCompanion(options: Options) {
  const catalog = useRef(new CompanionCatalog());
  const library = useRef(new CompanionLibrary());
  const busy = useRef(false), reading = useRef(false);
  const account = JSON.stringify(options.boot.account);
  const identity = useRef(account);
  if (identity.current !== account) {
    identity.current = account;
    catalog.current.clear();
    library.current.clear();
  }
  const current = useRef(options);
  current.current = options;
  const snapshot = (): ControllerReply => ({ state: {
    preferences: phonePreferences(current.current.boot.preferences),
    account: { app: current.current.boot.account.app, web: current.current.boot.account.web, screen: current.current.accountScreen },
    current: current.current.source ? catalog.current.present({ items: [current.current.source.item], hasMore: false }).catalog?.items[0] : undefined,
    player: current.current.player.current?.snapshot(), opening: current.current.opening, catalogVersion: catalog.current.version(),
  } });
  const execute = async (command: CompanionCommand | { kind: 'url'; text: string }): Promise<ControllerReply> => {
    const value = current.current;
    if (!value.ready) return { error: 'unavailable' };
    if (command.kind === 'snapshot') return snapshot();
    if (command.kind === 'tv-login') {
      if (value.opening || busy.current) return { error: 'busy' };
      if (value.blocked && !value.accountScreen) return { error: 'blocked' };
      value.login(command.operation);
      return {};
    }
    if (command.kind === 'cover') return catalog.current.cover(command.handle);
    if (command.kind === 'catalog' || command.kind === 'related' || command.kind === 'folders') {
      if (reading.current) return { error: 'busy' };
      reading.current = true;
      const identityAtStart = identity.current;
      try {
        if (command.kind === 'folders') return await library.current.list(value.boot);
        if (command.kind === 'catalog') return command.collection === 'favorites'
          ? await library.current.browse(command, value.boot, catalog.current) : await catalog.current.browse(command, value.boot);
        if (!value.source || command.session !== value.source.sessionId || !api.related) return { error: 'unavailable' };
        const data = await api.related(value.source.item);
        if (identityAtStart !== identity.current || current.current.source?.sessionId !== command.session) return { error: 'canceled' };
        return catalog.current.present(data);
      } finally { reading.current = false; }
    }
    if (busy.current || value.opening) return { error: 'busy' };
    if (value.blocked) return { error: 'blocked' };
    busy.current = true;
    try {
      if (command.kind === 'queue-edit') return await editCompanionQueue(command, value.boot.queue, catalog.current, value.queue);
      if (command.kind === 'collection-edit') return await library.current.edit(command, value.boot, catalog.current, value.collectionChanged);
      if (command.kind === 'settings') {
        const ok = await value.change({ ...value.boot.preferences, ...command.patch });
        return ok ? snapshot() : { error: 'failed' };
      }
      if (command.kind === 'player') return await value.player.current?.control(command.session, command.command) || { error: 'unavailable' };
      const item = command.kind === 'play' ? catalog.current.get(command.handle) : () => api.openUrl(command.text);
      if (!item) return { error: 'unavailable' };
      const run = () => current.current.play(item);
      return value.player.current ? await value.player.current.replace(run) : await run();
    } finally { busy.current = false; }
  };
  return execute;
}
