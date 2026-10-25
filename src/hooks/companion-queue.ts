import type { CompanionCommand } from '../shared/companion';
import type { ControllerReply } from '../shared/remote-control';
import type { MediaItem } from '../shared/types';
import type { CompanionCatalog } from './companion-catalog';

export async function editCompanionQueue(command: Extract<CompanionCommand, { kind: 'queue-edit' }>,
  items: MediaItem[], catalog: CompanionCatalog, update: (items: MediaItem[]) => Promise<boolean>): Promise<ControllerReply> {
  const item = catalog.get(command.handle);
  if (!item) return { error: 'unavailable' };
  const next = [...items];
  const index = next.findIndex(value => value.id === item.id && value.source === item.source);
  if (command.operation === 'add') {
    if (index >= 0) return {};
    next.push(item);
  } else {
    if (index < 0) return { error: 'unavailable' };
    if (command.operation === 'remove') next.splice(index, 1);
    else {
      const target = index + (command.operation === 'up' ? -1 : 1);
      if (target < 0 || target >= next.length) return {};
      [next[index], next[target]] = [next[target], next[index]];
    }
  }
  return await update(next) ? {} : { error: 'failed' };
}
