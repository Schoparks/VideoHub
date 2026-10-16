import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createFullscreenControl } from '../electron/window-fullscreen';
import { schemas } from '../electron/ipc';

class WindowFixture extends EventEmitter {
  fullscreen = false;
  destroyed = false;
  fail = false;
  calls: boolean[] = [];
  isDestroyed() { return this.destroyed; }
  isFullScreen() { return this.fullscreen; }
  setFullScreen(value: boolean) {
    if (this.fail) throw new Error('native failure');
    this.calls.push(value);
  }
  complete(value: boolean) {
    this.fullscreen = value;
    this.emit(value ? 'enter-full-screen' : 'leave-full-screen');
  }
}

describe('native fullscreen transitions', () => {
  it('waits for native confirmation, serializes requests and skips an already confirmed target', async () => {
    const window = new WindowFixture();
    const change = createFullscreenControl(() => window, false);
    const entered = change(true);
    const duplicate = change(true);
    const exited = change(false);
    await vi.waitFor(() => expect(window.calls).toEqual([true]));
    expect(window.fullscreen).toBe(false);
    window.complete(true);
    await entered;
    await duplicate;
    await vi.waitFor(() => expect(window.calls).toEqual([true, false]));
    window.complete(false);
    await exited;
    expect(window.eventNames()).toEqual([]);
  });

  it('rejects timeout, removes listeners and allows the next request', async () => {
    vi.useFakeTimers();
    try {
      const window = new WindowFixture();
      const change = createFullscreenControl(() => window, false, 20);
      const result = expect(change(true)).rejects.toThrow('全屏切换超时');
      await vi.advanceTimersByTimeAsync(25);
      await result;
      expect(window.eventNames()).toEqual([]);
      await change(false);
      expect(window.calls).toEqual([true]);
    } finally { vi.useRealTimers(); }
  });

  it('rejects a closing window and permits a later replacement window', async () => {
    let window = new WindowFixture();
    const previous = window;
    const change = createFullscreenControl(() => window, false);
    const result = expect(change(true)).rejects.toThrow('窗口已关闭');
    await vi.waitFor(() => expect(previous.calls).toEqual([true]));
    previous.destroyed = true;
    previous.emit('closed');
    await result;
    expect(previous.eventNames()).toEqual([]);
    window = new WindowFixture();
    const next = change(true);
    await vi.waitFor(() => expect(window.calls).toEqual([true]));
    window.complete(true);
    await next;
  });

  it('rejects native errors and absent or destroyed windows without leaking a listener', async () => {
    const window = new WindowFixture();
    window.fail = true;
    const change = createFullscreenControl(() => window, false);
    await expect(change(true)).rejects.toThrow('无法切换全屏');
    expect(window.eventNames()).toEqual([]);
    window.destroyed = true;
    await expect(change(true)).rejects.toThrow('窗口已关闭');
    await expect(createFullscreenControl(() => null, false)(true)).rejects.toThrow('窗口已关闭');
  });

  it('never changes a hidden test window, including queued requests', async () => {
    const window = new WindowFixture();
    const change = createFullscreenControl(() => window, true);
    await Promise.all([change(true), change(false), change(true)]);
    expect(window.calls).toEqual([]);
    expect(window.fullscreen).toBe(false);
    expect(window.eventNames()).toEqual([]);
    await createFullscreenControl(() => null, true)(true);
  });

  it('keeps fullscreen state reads argument-free and writes strictly boolean', () => {
    expect(schemas.getFullscreen.safeParse([]).success).toBe(true);
    expect(schemas.getFullscreen.safeParse([true]).success).toBe(false);
    expect(schemas.fullscreen.safeParse([true]).success).toBe(true);
    expect(schemas.fullscreen.safeParse(['true']).success).toBe(false);
  });
});
