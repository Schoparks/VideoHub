import { describe, expect, it, vi } from 'vitest';
import { createDanmakuWindow } from '../src/visual/danmaku-window';
import type { DanmakuComment } from '../src/shared/types';

const comments: DanmakuComment[] = Array.from({ length: 20000 }, (_, index) => ({
  id: String(index), time: index * .36, mode: 1, text: '长视频弹幕', color: '#ffffff',
}));

describe('bounded long-video danmaku work', () => {
  it('starts near a late resume position, yields, and stops measuring distant future comments', () => {
    const measure = vi.fn(() => 100);
    const layout = createDanmakuWindow(comments, 1920, 1080, 25, .5, measure);
    expect(layout.prepare(7200, Infinity, 20)).toBe(true);
    expect(measure.mock.calls.length).toBeLessThanOrEqual(20);
    for (let index = 0; index < 20; index++) layout.prepare(7200, Infinity);
    expect(measure.mock.calls.length).toBeLessThan(300);
    expect(layout.visible(7200).some(item => item.id === '19999')).toBe(true);
    const count = measure.mock.calls.length;
    expect(layout.prepare(7200, Infinity)).toBe(false);
    expect(measure).toHaveBeenCalledTimes(count);
  });

  it('rebuilds on seeks, discards stale entries, and resumes after a pause at the media clock', () => {
    const measure = vi.fn(() => 100);
    const layout = createDanmakuWindow(comments, 1920, 1080, 25, .5, measure);
    for (const time of [7200, 3600, 2]) {
      for (let index = 0; index < 20; index++) layout.prepare(time, Infinity);
      expect(layout.visible(time).every(item => item.time <= time && item.end > time)).toBe(true);
    }
    expect(layout.visible(2).some(item => item.id === '19999')).toBe(false);
    const visible = layout.visible(2);
    layout.prepare(2, Infinity);
    expect(layout.visible(2)).toEqual(visible);
    layout.prepare(4, Infinity);
    expect(layout.visible(4)).not.toEqual(visible);
    expect(measure.mock.calls.length).toBeLessThan(600);
  });
});
