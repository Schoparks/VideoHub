import { describe, expect, it } from 'vitest';
import { GamepadInterpreter, type Pad } from '../src/input/gamepad';
import { bindButton, actionKey } from '../src/input/bindings';
import { defaultPreferences } from '../src/shared/types';

const map = defaultPreferences.gamepadMap;
const pad = (): Pad => ({ id: 'test', mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 20 }, () => ({ pressed: false, value: 0 })) });

describe('controller interaction boundaries', () => {
  it('emits a held confirm only once and repeats navigation after the delay', () => {
    const input = new GamepadInterpreter(), controller = pad();
    controller.buttons[0].pressed = true; controller.buttons[13].pressed = true;
    expect(input.sample(controller, 0, map)).toEqual(['confirm', 'down']);
    expect(input.sample(controller, 419, map)).toEqual([]);
    expect(input.sample(controller, 420, map)).toEqual(['down']);
    expect(input.sample(controller, 534, map)).toEqual([]);
    expect(input.sample(controller, 535, map)).toEqual(['down']);
  });

  it('gives Back priority over simultaneous confirm and navigation', () => {
    const controller = pad();
    [0, 1, 13].forEach(index => { controller.buttons[index].pressed = true; });
    expect(new GamepadInterpreter().sample(controller, 0, map)).toEqual(['back']);
  });

  it('requires a competing held confirm to release after Back', () => {
    const input = new GamepadInterpreter(), controller = pad();
    controller.buttons[0].pressed = true; controller.buttons[1].pressed = true;
    expect(input.sample(controller, 0, map)).toEqual(['back']);
    controller.buttons[1].pressed = false;
    expect(input.sample(controller, 40, map)).toEqual([]);
    controller.buttons[0].pressed = false; input.sample(controller, 60, map);
    controller.buttons[0].pressed = true;
    expect(input.sample(controller, 80, map)).toEqual(['confirm']);
  });

  it('cancels opposing directions and triggers instead of oscillating', () => {
    const controller = pad();
    [6, 7, 12, 13, 14, 15].forEach(index => { controller.buttons[index].pressed = true; });
    expect(new GamepadInterpreter().sample(controller, 0, map)).toEqual([]);
  });

  it('lets D-pad take precedence over a drifting stick', () => {
    const controller = pad(); controller.axes = [.9, 0]; controller.buttons[13].pressed = true;
    expect(new GamepadInterpreter().sample(controller, 0, map)).toEqual(['down']);
  });

  it('keeps the diagonal direction stable near the axis boundary', () => {
    const input = new GamepadInterpreter(), controller = pad(); controller.axes = [.8, .7];
    expect(input.sample(controller, 0, map)).toEqual(['right']);
    controller.axes = [.7, .75];
    expect(input.sample(controller, 20, map)).toEqual([]);
    controller.axes = [.5, .9];
    expect(input.sample(controller, 40, map)).toEqual(['down']);
  });

  it('uses trigger hysteresis to prevent multiple taps near the threshold', () => {
    const input = new GamepadInterpreter(), controller = pad();
    controller.buttons[7].value = .56;
    expect(input.sample(controller, 0, map)).toEqual(['forward']);
    controller.buttons[7].value = .5;
    expect(input.sample(controller, 20, map)).toEqual([]);
    controller.buttons[7].value = .56;
    expect(input.sample(controller, 40, map)).toEqual([]);
    controller.buttons[7].value = .3; input.sample(controller, 60, map);
    controller.buttons[7].value = .56;
    expect(input.sample(controller, 80, map)).toEqual(['forward']);
  });

  it('waits for release after focus resumes or a binding changes', () => {
    const input = new GamepadInterpreter(), controller = pad();
    input.blockUntilNeutral(); controller.buttons[1].pressed = true;
    expect(input.sample(controller, 0, map)).toEqual([]);
    expect(input.sample(controller, 1000, map)).toEqual([]);
    controller.buttons[1].pressed = false; input.sample(controller, 1020, map);
    controller.buttons[1].pressed = true;
    expect(input.sample(controller, 1040, map)).toEqual(['back']);
  });

  it('resets repeat state on disconnect', () => {
    const input = new GamepadInterpreter(), controller = pad(); controller.buttons[15].pressed = true;
    input.sample(controller, 0, map); input.sample(undefined, 200, map);
    expect(input.sample(controller, 201, map)).toEqual(['right']);
  });

  it('swaps occupied bindings without making either action unreachable', () => {
    expect(bindButton(map, 'confirm', 1)).toEqual({ ...map, confirm: 1, back: 0 });
    expect(map.confirm).toBe(0);
  });

  it('reserves D-pad for navigation even with legacy conflicting mappings', () => {
    expect(bindButton(map, 'confirm', 12)).toBeUndefined();
    const controller = pad(); controller.buttons[12].pressed = true;
    expect(new GamepadInterpreter().sample(controller, 0, { ...map, confirm: 12 })).toEqual(['up']);
  });

  it('describes the actual mapping and keyboard keys', () => {
    expect(actionKey('confirm', { ...map, confirm: 1 }, 'gamepad')).toBe('B');
    expect(actionKey('confirm', map, 'keyboard')).toBe('Enter');
    expect(actionKey('confirm', map, 'gamepad', false)).toBe('按键 0');
  });
});
