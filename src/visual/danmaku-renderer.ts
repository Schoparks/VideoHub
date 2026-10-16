import { createDanmakuWindow } from './danmaku-window';
import { createDanmakuMotion } from './danmaku-motion';
import { createDanmakuLanes } from './danmaku-lanes';
import type { DanmakuPlacement } from '../shared/danmaku-layout';
import type { DanmakuComment } from '../shared/types';

/** Own only the decorative spans; media, focus and React state stay with the player. */
export function startDanmakuRenderer(host: HTMLElement, video: HTMLVideoElement,
  comments: DanmakuComment[], width: number, height: number, font: number, area: number) {
  const context = document.createElement('canvas').getContext('2d');
  if (context) context.font = `600 ${font}px "Microsoft YaHei", sans-serif`;
  const layout = createDanmakuWindow(comments, width, height, font, area,
    text => context?.measureText(text).width || text.length * font);
  const lanes = createDanmakuLanes(host, video, width);
  const grouped = typeof HTMLElement.prototype.animate === 'function' && typeof video.paused === 'boolean';
  const nodes = new Map<string, { node: HTMLSpanElement; comment: DanmakuPlacement;
    motion?: ReturnType<typeof createDanmakuMotion> }>();
  let frame = 0, stopped = false;
  let previousTime = -1;
  let previousState = '';
  let drawnAt = -Infinity;
  const draw = (built: boolean, force = false) => {
    const time = video.currentTime;
    const state = `${video.paused}:${video.seeking}:${video.readyState}:${video.playbackRate}`;
    if (time === previousTime && state === previousState && !built && !force) return;
    previousTime = time;
    previousState = state;
    const visible = layout.visible(time);
    const identities = new Set(visible.map(comment => comment.id));
    for (const [id, entry] of nodes) {
      if (!identities.has(id)) {
        entry.motion?.stop();
        entry.node.remove();
        if (!entry.motion) lanes.remove(entry.comment);
        nodes.delete(id);
      }
    }
    for (const comment of visible) {
      let entry = nodes.get(comment.id);
      if (!entry) {
        const node = document.createElement('span');
        node.textContent = comment.text;
        node.style.color = comment.color;
        const scrollingLane = grouped && (comment.mode === 1 || comment.mode === 6);
        if (scrollingLane) lanes.add(node, comment, time);
        else host.append(node);
        entry = { node, comment, motion: scrollingLane ? undefined : createDanmakuMotion(node, comment, width, video) };
        nodes.set(comment.id, entry);
      }
      entry.motion?.update(time, force);
    }
    lanes.update(time, force);
  };
  const tick = (now: number) => {
    if (stopped) return;
    // The compositor animates every display frame. JS only admits/removes text at 20 Hz.
    if (now - drawnAt >= 50) {
      drawnAt = now;
      draw(layout.prepare(video.currentTime));
    }
    frame = requestAnimationFrame(tick);
  };
  const changed = () => {
    if (!stopped) draw(layout.prepare(video.currentTime), true);
  };
  const events = ['pause', 'playing', 'waiting', 'seeking', 'seeked', 'ratechange', 'ended'];
  events.forEach(event => video.addEventListener?.(event, changed));
  frame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    events.forEach(event => video.removeEventListener?.(event, changed));
    nodes.forEach(entry => { entry.motion?.stop(); entry.node.remove(); });
    nodes.clear();
    lanes.stop();
  };
}
