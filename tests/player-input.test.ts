import { describe, expect, it, vi } from 'vitest';
import { playerAction } from '../src/input/player-actions';

const context = () => ({
  controls: true, error: false, episodes: false, seeking: false, multipart: true, onTimeline: false,
  closeEpisodes: vi.fn(), cancelSeek: vi.fn(), leave: vi.fn(), toggle: vi.fn(), next: vi.fn(),
  closeOptions: vi.fn(), hideControls: vi.fn(),
  previous: vi.fn(), queue: vi.fn(), showEpisodes: vi.fn(), settings: vi.fn(), preview: vi.fn(),
  commitSeek: vi.fn(), reveal: vi.fn(),
});

describe('player semantic input', () => {
  it('consumes playback actions while exit is already saving and restoring', () => {
    const state = { ...context(), exiting: true };
    for (const action of ['up', 'down', 'left', 'right', 'confirm', 'back', 'details', 'search', 'previous', 'next', 'rewind', 'forward', 'pause'] as const) {
      expect(playerAction(action, state)).toBe(true);
    }
    for (const value of Object.values(state)) {
      if (typeof value === 'function') expect(value).not.toHaveBeenCalled();
    }
  });

  it('backs out of episodes, then seeking, then hides controls before leaving playback', () => {
    const state = context(); state.episodes = true; state.seeking = true;
    playerAction('back', state); expect(state.closeEpisodes).toHaveBeenCalledOnce();
    expect(state.leave).not.toHaveBeenCalled();
    state.episodes = false; playerAction('back', state);
    expect(state.cancelSeek).toHaveBeenCalledOnce(); expect(state.leave).not.toHaveBeenCalled();
    state.seeking = false; playerAction('back', state); expect(state.hideControls).toHaveBeenCalledOnce();
    expect(state.leave).not.toHaveBeenCalled();
    state.controls = false; playerAction('back', state); expect(state.leave).toHaveBeenCalledOnce();
  });

  it('keeps a seek preview isolated from episode and queue navigation', () => {
    const state = context(); state.seeking = true;
    for (const action of ['details', 'search', 'next', 'previous', 'up', 'down'] as const) expect(playerAction(action, state)).toBe(true);
    expect(state.queue).not.toHaveBeenCalled(); expect(state.next).not.toHaveBeenCalled();
    playerAction('confirm', state); expect(state.commitSeek).toHaveBeenCalledOnce();
  });

  it('uses 10-second directional and 30-second trigger previews', () => {
    const state = context(); state.onTimeline = true;
    playerAction('left', state); playerAction('right', state);
    playerAction('rewind', state); playerAction('forward', state);
    expect(state.preview.mock.calls).toEqual([[-10], [10], [-30], [30]]);
  });

  it('lets left and right navigate visible controls away from the timeline', () => {
    const state = context(); expect(playerAction('right', state)).toBe(false);
    expect(state.preview).not.toHaveBeenCalled(); expect(state.reveal).toHaveBeenCalled();
  });

  it('reveals hidden controls on up/down and toggles on confirm', () => {
    const state = context(); state.controls = false;
    expect(playerAction('up', state)).toBe(true); expect(state.reveal).toHaveBeenCalledWith(true);
    playerAction('confirm', state); expect(state.toggle).toHaveBeenCalledOnce();
  });

  it('reveals the timeline on Down with a playback fallback for live or unready media', () => {
    const state = { ...context(), controls: false };
    expect(playerAction('down', state)).toBe(true);
    expect(state.reveal).toHaveBeenCalledWith(true, ['.timeline:not(:disabled)', '[data-focus-default]']);
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.toggle).not.toHaveBeenCalled();
  });

  it('keeps failure controls navigable and suppresses playback shortcuts', () => {
    const state = context(); state.error = true;
    expect(playerAction('confirm', state)).toBe(false);
    expect(playerAction('pause', state)).toBe(true); expect(state.toggle).not.toHaveBeenCalled();
    expect(playerAction('next', state)).toBe(true); expect(state.next).not.toHaveBeenCalled();
  });

  it('isolates episode selection from timeline and queue shortcuts', () => {
    const state = context(); state.episodes = true;
    expect(playerAction('down', state)).toBe(false); playerAction('search', state);
    expect(state.queue).not.toHaveBeenCalled(); playerAction('details', state);
    expect(state.closeEpisodes).toHaveBeenCalledOnce();
  });

  it('keeps pause scoped to the player after episode selection closes', () => {
    const state = context();
    state.episodes = true;
    expect(playerAction('pause', state)).toBe(true);
    expect(state.toggle).not.toHaveBeenCalled();
    expect(playerAction('confirm', state)).toBe(false);
    expect(playerAction('down', state)).toBe(false);
    playerAction('back', state);
    expect(state.closeEpisodes).toHaveBeenCalledOnce();
    expect(state.hideControls).not.toHaveBeenCalled();
    state.episodes = false;
    expect(playerAction('pause', state)).toBe(true);
    expect(state.toggle).toHaveBeenCalledOnce();
  });

  it('opens episodes for multipart sources and settings for a single item', () => {
    const state = context(); playerAction('details', state); expect(state.showEpisodes).toHaveBeenCalledOnce();
    state.multipart = false; playerAction('details', state); expect(state.settings).toHaveBeenCalledOnce();
  });

  it('keeps return available while a source change blocks conflicting playback actions', () => {
    const state = { ...context(), switching: true };
    for (const action of ['pause', 'next', 'previous', 'details', 'search', 'rewind', 'forward', 'confirm'] as const) {
      expect(playerAction(action, state)).toBe(true);
    }
    expect(state.toggle).not.toHaveBeenCalled();
    expect(state.queue).not.toHaveBeenCalled();
    expect(state.next).not.toHaveBeenCalled();
    expect(playerAction('down', state)).toBe(false);
    playerAction('back', state);
    expect(state.hideControls).toHaveBeenCalledOnce();
    state.controls = false;
    playerAction('back', state);
    expect(state.leave).toHaveBeenCalledOnce();
  });

  it('does not adjust a seek position while its replacement source is pending', () => {
    const state = { ...context(), switching: true, onTimeline: true };
    expect(playerAction('right', state)).toBe(true);
    expect(state.preview).not.toHaveBeenCalled();
  });

  it('isolates option menus and closes them before controls without committing a choice', () => {
    const state = { ...context(), options: true, seeking: true };
    for (const action of ['pause', 'next', 'previous', 'details', 'search', 'rewind', 'forward'] as const) {
      expect(playerAction(action, state)).toBe(true);
    }
    expect(playerAction('down', state)).toBe(false);
    expect(playerAction('confirm', state)).toBe(false);
    playerAction('back', state);
    expect(state.closeOptions).toHaveBeenCalledOnce();
    expect(state.toggle).not.toHaveBeenCalled();
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.hideControls).not.toHaveBeenCalled();
    expect(state.leave).not.toHaveBeenCalled();
  });

  it('returns directly from a playback error even if the controls flag remains set', () => {
    const state = { ...context(), error: true };
    playerAction('back', state);
    expect(state.leave).toHaveBeenCalledOnce();
    expect(state.hideControls).not.toHaveBeenCalled();
  });
});
