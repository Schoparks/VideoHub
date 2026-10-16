import { describe, expect, it, vi } from 'vitest';
import { HistorySync } from '../electron/playback/history-sync';

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(finish => { resolve = finish; });
  return { promise, resolve };
}

describe('background platform history', () => {
  it('serializes writes and coalesces waiting progress to its latest position', async () => {
    const sync = new HistorySync();
    const first = deferred();
    const complete = vi.fn();
    const old = vi.fn(async () => true);
    const latest = vi.fn(async () => true);
    const other = vi.fn(async () => true);
    sync.enqueue('episode-one', { run: () => first.promise, complete });
    sync.enqueue('episode-one', { run: old, complete });
    sync.enqueue('episode-one', { run: latest, complete });
    sync.enqueue('episode-two', { run: other, complete });
    expect(latest).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    first.resolve(true);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(3));
    expect(old).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(latest.mock.invocationCallOrder[0]).toBeLessThan(other.mock.invocationCallOrder[0]);
  });

  it('distinguishes failures from skipped authorization and continues after failure', async () => {
    const sync = new HistorySync();
    const complete = vi.fn();
    sync.enqueue('failed', { run: async () => { throw new Error('network'); }, complete });
    sync.enqueue('skipped', { run: async () => false, complete });
    sync.enqueue('success', { run: async () => true, complete });
    await vi.waitFor(() => expect(complete.mock.calls).toEqual([['failed'], ['skipped'], ['synced']]));
  });

  it('stops waiting writes without waiting for an in-flight network request', async () => {
    const sync = new HistorySync();
    const first = deferred();
    const queued = vi.fn(async () => true);
    sync.enqueue('one', { run: () => first.promise, complete: vi.fn() });
    sync.enqueue('two', { run: queued, complete: vi.fn() });
    sync.stop();
    sync.enqueue('three', { run: queued, complete: vi.fn() });
    first.resolve(true);
    await first.promise;
    expect(queued).not.toHaveBeenCalled();
  });
});
