import type { CompanionCommand, CompanionSettings, PlayerCommand } from './companion';
import { bilibiliQualityLimits } from './bilibili-quality';

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const number = (value: unknown, min: number, max: number): value is number => typeof value === 'number'
  && Number.isFinite(value) && value >= min && value <= max;
const oneOf = (value: unknown, choices: readonly unknown[]) => choices.includes(value);

function settings(value: unknown): Partial<CompanionSettings> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const entries = Object.entries(value);
  const validators: Record<keyof CompanionSettings, (value: unknown) => boolean> = {
    tvMode: value => typeof value === 'boolean', theme: value => oneOf(value, ['light', 'dark']),
    cardColumns: value => oneOf(value, [0, 2, 3, 4, 5, 6]),
    playbackRate: value => number(value, .5, 2), autoNext: value => typeof value === 'boolean',
    syncHistory: value => typeof value === 'boolean', danmaku: value => typeof value === 'boolean',
    danmakuOpacity: value => number(value, .2, 1), danmakuFontSize: value => number(value, 18, 40) && Number.isInteger(value),
    danmakuArea: value => oneOf(value, [.25, .5, 1]),
    bilibiliMaxQuality: value => bilibiliQualityLimits.some(limit => limit.id === value),
    bilibiliQualityMode: value => oneOf(value, ['highest', 'remember']),
  };
  if (entries.some(([key, item]) => !Object.hasOwn(validators, key) || !validators[key as keyof CompanionSettings](item))) return;
  return Object.fromEntries(entries);
}

function player(value: unknown): PlayerCommand | undefined {
  if (!value || typeof value !== 'object') return;
  const command = value as Record<string, unknown>;
  if (oneOf(command.operation, ['toggle', 'previous', 'next', 'stop', 'retry'])) {
    return { operation: command.operation } as PlayerCommand;
  }
  if (command.operation === 'seek' && number(command.value, 0, Number.MAX_VALUE)) return { operation: 'seek', value: command.value };
  if (command.operation === 'rate' && oneOf(command.value, [.5, .75, 1, 1.25, 1.5, 2])) return { operation: 'rate', value: command.value } as PlayerCommand;
  if (command.operation === 'quality' && number(command.value, 1, 127) && Number.isInteger(command.value)) return { operation: 'quality', value: command.value };
  if (command.operation === 'episode' && text(command.value, 100)) return { operation: 'episode', value: command.value };
}

/** Lightweight counterpart to the IPC schema, runnable on WebView 66 without Zod/BigInt. */
export function parseCompanionCommand(input: Record<string, unknown>): CompanionCommand | undefined {
  if (input.kind === 'snapshot') return { kind: 'snapshot' };
  if (input.kind === 'tv-login' && oneOf(input.operation, ['app', 'web', 'close'])) {
    return { kind: 'tv-login', operation: input.operation } as CompanionCommand;
  }
  if (input.kind === 'folders') return { kind: 'folders' };
  if (input.kind === 'queue-edit' && uuid(input.handle) && oneOf(input.operation, ['add', 'remove', 'up', 'down'])) {
    return { kind: 'queue-edit', handle: input.handle, operation: input.operation } as CompanionCommand;
  }
  if (input.kind === 'collection-edit' && uuid(input.handle) && typeof input.add === 'boolean'
    && oneOf(input.collection, ['favorites', 'watchlater']) && (input.folder === undefined || uuid(input.folder))) {
    return { kind: 'collection-edit', handle: input.handle, add: input.add,
      collection: input.collection, folder: input.folder } as CompanionCommand;
  }
  if ((input.kind === 'play' || input.kind === 'cover') && uuid(input.handle)) return { kind: input.kind, handle: input.handle };
  if (input.kind === 'related' && uuid(input.session)) return { kind: 'related', session: input.session };
  if (input.kind === 'settings') {
    const patch = settings(input.patch);
    if (patch) return { kind: 'settings', patch };
  }
  if (input.kind === 'player' && uuid(input.session)) {
    const command = player(input.command);
    if (command) return { kind: 'player', session: input.session, command };
  }
  if (input.kind !== 'catalog' || !oneOf(input.collection, ['recommend', 'search', 'local', 'history', 'localHistory', 'queue', 'watchlater', 'followingLive', 'favorites', 'dynamic', 'regions', 'cinema', 'followingCinema'])) return;
  if (input.category !== undefined && (!number(input.category, 1, 1000) || !Number.isInteger(input.category))) return;
  if (input.dynamicType !== undefined && !oneOf(input.dynamicType, ['all', 'video'])) return;
  if (input.folder !== undefined && !uuid(input.folder)) return;
  if (input.keyword !== undefined && (!text(input.keyword, 200) || !input.keyword.trim())) return;
  if (input.searchType !== undefined && !oneOf(input.searchType, ['all', 'video', 'media_bangumi', 'media_ft', 'live_room'])) return;
  if (input.page !== undefined && (!number(input.page, 1, 10000) || !Number.isInteger(input.page))) return;
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 1000)) return;
  if (input.refresh !== undefined && typeof input.refresh !== 'boolean') return;
  return { kind: 'catalog', collection: input.collection, keyword: (input.keyword as string | undefined)?.trim(),
    category: input.category, dynamicType: input.dynamicType,
    folder: input.folder, searchType: input.searchType, page: input.page, cursor: input.cursor, refresh: input.refresh } as CompanionCommand;
}
