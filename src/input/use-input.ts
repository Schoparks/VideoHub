import { useEffect, useRef, useState } from 'react';
import type { Preferences } from '../shared/types';
import { GamepadInterpreter, type Action } from './gamepad';
import { activeFocusScope, ensureFocus, focusElement, FocusRecovery, moveFocus, trapTab } from './focus';
import { adjustRange, adjustSelect, scrollContent } from './controls';
import { createInputHint } from './hints';
import { remoteAction } from './remote';
import { isControllerAction } from '../shared/remote-control';
import { createSettingEditing } from './setting-editing';
import './focus.css';

export function useInput(preferences: Preferences, handler: (action: Action) => boolean | void) {
  const callback = useRef(handler);
  callback.current = handler;
  const config = useRef(preferences);
  config.current = preferences;
  const [device, setDevice] = useState('');
  useEffect(() => {
    const interpreter = new GamepadInterpreter();
    const recovery = new FocusRecovery();
    const hint = createInputHint();
    const settingEditing = createSettingEditing();
    let frame = 0, previousDevice = '', padIndex = -1, lastUpdate = 0;
    let standard = true, calibrating = false;
    const updateHint = () => hint.update(config.current, standard);
    const activate = (mode: 'gamepad' | 'remote' | 'keyboard' | 'pointer') => {
      const changed = document.documentElement.dataset.inputMode !== mode;
      document.documentElement.dataset.inputMode = mode;
      updateHint();
      const focused = document.activeElement;
      if (changed && (mode === 'gamepad' || mode === 'remote') && activeFocusScope() === document
        && focused instanceof HTMLElement && focused.closest('main') && !focused.hasAttribute('data-gamepad-skip')) {
        // The hint footer changes the browse viewport when returning from pointer input.
        focusElement(focused);
      }
    };
    const act = (action: Action, gamepad = false) => {
      if (!document.dispatchEvent(new CustomEvent('hub-input-action', { detail: action, cancelable: true }))) {
        updateHint();
        return;
      }
      if (gamepad && document.activeElement?.hasAttribute('data-gamepad-skip')) ensureFocus();
      if (settingEditing.action(action)) { updateHint(); return; }
      // Active playback modes own actions before text scrolling or focus repair.
      if (callback.current(action)) {
        updateHint();
        return;
      }
      ensureFocus();
      const focused = document.activeElement;
      if ((action === 'up' || action === 'down') && focused instanceof HTMLElement
        && focused.hasAttribute('data-scroll-content') && scrollContent(focused, action === 'down' ? 1 : -1)) return;
      if (['confirm', 'left', 'right'].includes(action) && focused?.getAttribute('aria-disabled') === 'true'
        && (action === 'confirm' || focused instanceof HTMLSelectElement || focused instanceof HTMLInputElement)) return;
      if ((action === 'left' || action === 'right' || action === 'confirm') && focused instanceof HTMLSelectElement) {
        adjustSelect(focused, action === 'left' ? -1 : 1, action === 'confirm');
      } else if ((action === 'left' || action === 'right') && focused instanceof HTMLInputElement && focused.type === 'range') {
        adjustRange(focused, action === 'right' ? 1 : -1);
      } else if (gamepad && action === 'confirm' && focused instanceof HTMLInputElement && !['range', 'checkbox', 'radio'].includes(focused.type)) {
        focused.dispatchEvent(new CustomEvent('gamepad-edit', { bubbles: true }));
      } else if (['up', 'down', 'left', 'right'].includes(action)) {
        moveFocus(action as 'up');
      } else if (action === 'confirm') {
        (document.activeElement as HTMLElement)?.click();
      }
      recovery.repair();
      updateHint();
    };
    const poll = (now: number) => {
      const pads = Array.from(navigator.getGamepads?.() || []).filter((pad): pad is Gamepad => !!pad && pad.connected !== false);
      const active = (pad: Gamepad) => pad.buttons.some(button => button.pressed || button.value > .55) || pad.axes.slice(0, 2).some(value => Math.abs(value) > config.current.deadzone);
      const current = pads.find(pad => pad.index === padIndex);
      const pad = current && active(current) ? current : pads.find(active) || current || pads[0];
      const identity = pad ? `${pad.index}:${pad.id}` : '';
      if (identity !== previousDevice) {
        const replacing = !!previousDevice;
        previousDevice = identity;
        padIndex = pad?.index ?? -1;
        interpreter.reset();
        if (replacing && pad) interpreter.blockUntilNeutral();
        setDevice(pad?.id || '');
        standard = pad?.mapping === 'standard';
        if (pad && document.hasFocus() && !document.hidden) {
          activate('gamepad');
          recovery.repair();
        }
        else if (document.documentElement.dataset.inputMode === 'gamepad') activate('keyboard');
      }
      const capturing = !!document.querySelector('[data-calibrating="true"]');
      if (calibrating && !capturing) interpreter.blockUntilNeutral();
      calibrating = capturing;
      const actions = interpreter.sample(pad, now, config.current.gamepadMap, config.current.deadzone);
      if (document.hasFocus() && !document.hidden && !capturing) {
        for (const action of actions) {
          activate('gamepad');
          act(action, true);
        }
        if (now - lastUpdate > 100) {
          if (['gamepad', 'remote'].includes(document.documentElement.dataset.inputMode || '')) recovery.repair();
          updateHint();
          lastUpdate = now;
        }
      } else updateHint();
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    const keyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) return;
      activate('keyboard');
      if (event.key === 'Tab' && activeFocusScope() instanceof HTMLElement && (activeFocusScope() as HTMLElement).matches('.player:not(.controls-visible)')) {
        event.preventDefault();
        callback.current('up');
        return;
      }
      trapTab(event);
      const element = event.target as HTMLElement;
      const editing = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement && !['range', 'checkbox', 'radio'].includes(element.type);
      const settingControl = !!element.closest('.settings') && element.matches('select, input[type="range"]');
      if ((editing || element instanceof HTMLSelectElement && !settingControl) && event.key !== 'Escape') return;
      const map: Record<string, Action> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'confirm',
        Escape: 'back', ContextMenu: 'menu', ' ': 'pause', PageUp: 'previous', PageDown: 'next', x: 'details', y: 'search', '[': 'rewind', ']': 'forward',
      };
      const action = map[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      // Dialog buttons and switches keep native Space activation, even over a player.
      if (action === 'pause') {
        if (document.querySelector('[data-calibrating="true"]')) { event.preventDefault(); return; }
        const scope = activeFocusScope();
        if (!(scope instanceof HTMLElement && scope.matches('.player'))) return;
      }
      event.preventDefault();
      if (event.repeat && !['up', 'down', 'left', 'right', 'rewind', 'forward'].includes(action)) return;
      act(action);
    };
    const pointer = () => activate('pointer');
    const remote = (event: Event) => {
      const action = remoteAction((event as CustomEvent).detail);
      if (!action || document.hidden) return;
      activate('remote');
      act(action, true);
    };
    const pointerMove = (event: PointerEvent) => { if (event.movementX || event.movementY) pointer(); };
    const controller = (event: Event) => {
      const action: unknown = (event as CustomEvent).detail;
      if (!isControllerAction(action) || document.hidden) return;
      event.preventDefault();
      activate(window.hubPlatform === 'android' ? 'remote' : 'gamepad');
      act(action, true);
    };
    const suspend = () => {
      interpreter.blockUntilNeutral();
      updateHint();
    };
    const focused = () => {
      recovery.remember();
      updateHint();
    };
    window.addEventListener('keydown', keyboard);
    window.addEventListener('hub-remote', remote);
    window.addEventListener('hub-controller-action', controller);
    if (window.hubPlatform === 'android') { activate('remote'); recovery.repair(); }
    window.addEventListener('blur', suspend);
    window.addEventListener('focus', suspend);
    document.addEventListener('visibilitychange', suspend);
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('pointermove', pointerMove, { passive: true });
    document.addEventListener('focusin', focused);
    document.addEventListener('change', updateHint);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('hub-remote', remote);
      window.removeEventListener('hub-controller-action', controller);
      window.removeEventListener('blur', suspend);
      window.removeEventListener('focus', suspend);
      document.removeEventListener('visibilitychange', suspend);
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('focusin', focused);
      document.removeEventListener('change', updateHint);
      hint.remove();
      settingEditing.destroy();
    };
  }, []);
  return device;
}
