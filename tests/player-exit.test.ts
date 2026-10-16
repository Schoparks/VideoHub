import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayerExit } from '../src/hooks/player-exit';

const focus = vi.hoisted(() => ({ scope: { querySelector: vi.fn() }, apply: vi.fn() }));
vi.mock('../src/input/focus', () => ({ activeFocusScope: () => focus.scope, focusElement: focus.apply }));
let frame: FrameRequestCallback;
beforeEach(() => {
  focus.scope = { querySelector: vi.fn(() => ({ id: 'return-entry' })) };
  focus.apply.mockClear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
});
afterEach(() => vi.unstubAllGlobals());

describe('player exit coordination', () => {
  it('starts once, focuses return and waits for save then restore before closing', async () => {
    let leaving = false;
    let finishSave!: () => void;
    let finishRestore!: () => void;
    const calls: string[] = [];
    const leave = createPlayerExit({
      isLeaving: () => leaving,
      start: () => { leaving = true; calls.push('start'); },
      stop: () => { calls.push('stop'); },
      reveal: () => { calls.push('reveal'); },
      flush: () => { calls.push('save'); return new Promise(resolve => { finishSave = resolve; }); },
      restore: () => { calls.push('restore'); return new Promise(resolve => { finishRestore = resolve; }); },
      close: () => { calls.push('close'); },
    });
    const first = leave();
    await leave();
    expect(calls).toEqual(['start', 'stop', 'reveal', 'save']);
    frame(0);
    expect(focus.apply).toHaveBeenCalledWith({ id: 'return-entry' }, false);
    finishSave();
    await vi.waitFor(() => expect(calls.at(-1)).toBe('restore'));
    expect(calls).not.toContain('close');
    finishRestore();
    await first;
    expect(calls).toEqual(['start', 'stop', 'reveal', 'save', 'restore', 'close']);
  });

  it('does not redirect focus into a new player or dialog when its queued frame arrives late', async () => {
    let leaving = false;
    const originalScope = focus.scope;
    const leave = createPlayerExit({
      isLeaving: () => leaving,
      start: () => { leaving = true; },
      stop: vi.fn(), reveal: vi.fn(), flush: async () => {}, restore: async () => {}, close: vi.fn(),
    });
    await leave();
    focus.scope = { querySelector: vi.fn(() => ({ id: 'new-player-return' })) };
    frame(0);
    expect(originalScope.querySelector).not.toHaveBeenCalled();
    expect(focus.scope.querySelector).not.toHaveBeenCalled();
    expect(focus.apply).not.toHaveBeenCalled();
  });
});
