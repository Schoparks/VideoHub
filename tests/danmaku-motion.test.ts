import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDanmakuMotion } from '../src/visual/danmaku-motion';

afterEach(() => vi.unstubAllGlobals());
function fixture(rate = 1) {
  vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3 });
  let position = 0, reads = 0, writes = 0;
  const animation = {
    playbackRate: 1,
    get currentTime() { reads++; return position; },
    set currentTime(value: number) { writes++; position = value; },
    pause: vi.fn(), play: vi.fn(), cancel: vi.fn(),
  };
  const video = { paused: false, seeking: false, readyState: 4, playbackRate: rate };
  const node = { animate: () => animation, style: {} } as unknown as HTMLSpanElement;
  const motion = createDanmakuMotion(node, { id: '1', mode: 1, time: 0, end: 10,
    width: 480, y: 12, speed: 240, color: '#fff', text: '弹幕' }, 1920, video as HTMLVideoElement);
  return { animation, video, motion, advance: (time: number) => { position = time * 1000; },
    counts: () => ({ reads, writes }) };
}

describe('compositor danmaku synchronization cost', () => {
  it('does not read or write animation state every display frame', () => {
    const f = fixture();
    for (let frame = 0; frame < 120; frame++) {
      f.advance(frame / 60);
      f.motion.update(frame / 60);
    }
    expect(f.counts().reads).toBeLessThanOrEqual(4);
    expect(f.counts().writes).toBe(1);
    expect(f.animation.play).toHaveBeenCalledOnce();
  });

  it('applies initial speed, pauses exactly once, and anchors even a small explicit seek', () => {
    const f = fixture(2);
    f.motion.update(1);
    expect(f.animation.playbackRate).toBe(2);
    f.video.paused = true;
    f.motion.update(1.1);
    const before = f.counts().writes;
    for (let frame = 0; frame < 60; frame++) f.motion.update(1.1);
    expect(f.animation.pause).toHaveBeenCalledOnce();
    expect(f.counts().writes).toBe(before);
    f.video.paused = false;
    f.motion.update(1.2, true);
    expect(f.animation.currentTime).toBe(1200);
    f.motion.stop();
    expect(f.animation.cancel).toHaveBeenCalledOnce();
  });
});
