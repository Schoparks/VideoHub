/** Decorative translation driven by the media clock; never controls the media. */
export function createMediaTranslation(node: HTMLElement, from: number, to: number, y: number,
  start: number, end: number, video: HTMLVideoElement) {
  const translate = (x: number) => `translate(${x}px, ${y}px)`;
  const animation = from !== to && typeof node.animate === 'function' && typeof video.paused === 'boolean'
    ? node.animate([{ transform: translate(from) }, { transform: translate(to) }],
      { duration: (end - start) * 1000, fill: 'both', easing: 'linear' })
    : undefined;
  let previousTime = -1;
  let previousPaused: boolean | undefined;
  let previousRate = 1;
  let checkedAt = -Infinity;
  return {
    update(time: number, force = false) {
      const elapsed = time - start;
      if (!animation) {
        if (time === previousTime) return;
        node.style.transform = translate(from + (to - from) * elapsed / (end - start));
        previousTime = time;
        return;
      }
      const position = elapsed * 1000;
      const paused = video.paused || video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
      const rate = video.playbackRate;
      const rateChanged = previousRate !== rate;
      if (rateChanged) animation.playbackRate = rate;
      if (paused && previousPaused !== true) animation.pause();
      const changed = force || previousPaused !== paused || rateChanged || previousTime < 0
        || time < previousTime || time > previousTime + 1;
      // Animation clocks can synchronize the compositor; sample drift at most twice a second.
      const check = time >= checkedAt + .5;
      if (changed || paused && time !== previousTime
        || check && Math.abs(Number(animation.currentTime) - position) > 250) {
        animation.currentTime = position;
      }
      if (check || changed) checkedAt = time;
      if (!paused && previousPaused !== false) animation.play();
      previousTime = time;
      previousPaused = paused;
      previousRate = rate;
    },
    stop: () => animation?.cancel(),
  };
}
