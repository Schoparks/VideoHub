import type { Action } from './gamepad';

interface Context {
  controls: boolean;
  error: boolean;
  episodes: boolean;
  options?: boolean;
  seeking: boolean;
  multipart: boolean;
  onTimeline: boolean;
  switching?: boolean;
  exiting?: boolean;
  closeEpisodes: () => void;
  closeOptions: () => void;
  hideControls: () => void;
  cancelSeek: () => void;
  leave: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  queue: () => void;
  showEpisodes: () => void;
  settings: () => void;
  preview: (offset: number) => void;
  commitSeek: () => void;
  reveal: (focus?: boolean, targets?: readonly string[]) => void;
}

export function playerAction(action: Action, context: Context) {
  if (context.exiting) return true;
  if (action === 'back') {
    if (context.options) context.closeOptions();
    else if (context.episodes) context.closeEpisodes();
    else if (context.seeking) context.cancelSeek();
    else if (context.controls && !context.error) context.hideControls();
    else context.leave();
    return true;
  }
  if (context.options) return !['up', 'down', 'left', 'right', 'confirm'].includes(action);
  if (action === 'menu') {
    if (!context.error && !context.episodes && !context.seeking && !context.switching) context.reveal(true, ['[aria-label="播放设置"]', '[data-focus-default]']);
    return true;
  }
  if (context.switching && (['pause', 'next', 'previous', 'rewind', 'forward', 'details', 'search', 'confirm'].includes(action)
    || context.onTimeline && ['left', 'right'].includes(action))) return true;
  if (context.error) return !['up', 'down', 'left', 'right', 'confirm'].includes(action);
  if (context.episodes) {
    if (action === 'details') {
      context.closeEpisodes();
      return true;
    }
    return ['pause', 'next', 'previous', 'search', 'rewind', 'forward'].includes(action);
  }
  if (action === 'pause') {
    context.toggle();
    return true;
  }
  if (action === 'rewind' || action === 'forward' || ((!context.controls || context.seeking || context.onTimeline) && (action === 'left' || action === 'right'))) {
    context.preview(action === 'rewind' ? -30 : action === 'forward' ? 30 : action === 'left' ? -10 : 10);
    return true;
  }
  if (context.seeking) {
    if (action === 'confirm') context.commitSeek();
    return true;
  }
  if (action === 'next') {
    context.next();
    return true;
  }
  if (action === 'previous') {
    context.previous();
    return true;
  }
  if (action === 'search') {
    context.queue();
    return true;
  }
  if (action === 'details') {
    if (context.multipart) context.showEpisodes();
    else context.settings();
    return true;
  }
  if (!context.controls && action === 'confirm') {
    context.toggle();
    context.reveal(true);
    return true;
  }
  if (!context.controls && ['up', 'down'].includes(action)) {
    if (action === 'down') context.reveal(true, ['.timeline:not(:disabled)', '[data-focus-default]']);
    else context.reveal(true);
    return true;
  }
  if (['up', 'down', 'left', 'right', 'confirm'].includes(action)) context.reveal();
  return false;
}
