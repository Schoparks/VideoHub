export type Action = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'menu' | 'details' | 'search' | 'previous' | 'next' | 'rewind' | 'forward' | 'pause';
export interface Pad {
  id: string;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

const directions: [number, Action][] = [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']];
const repeatable = new Set<Action>(['up', 'down', 'left', 'right', 'rewind', 'forward']);

export class GamepadInterpreter {
  private held = new Map<Action, number>();
  private direction: Action | undefined;
  private pressed = new Set<number>();
  private suppressed = new Set<Action>();
  private blocked = false;

  reset() {
    this.held.clear();
    this.pressed.clear();
    this.suppressed.clear();
    this.direction = undefined;
    this.blocked = false;
  }

  blockUntilNeutral() { this.reset(); this.blocked = true; }

  sample(pad: Pad | undefined, now: number, map: Record<string, number>, deadzone = .28): Action[] {
    if (!pad) { this.reset(); return []; }
    if (this.blocked) {
      const pressed = pad.buttons.some(button => button.pressed || button.value > .4);
      const tilted = pad.axes.slice(0, 2).some(value => Math.abs(value) > deadzone);
      if (pressed || tilted) return [];
      this.blocked = false;
    }
    pad.buttons.forEach((button, index) => {
      const threshold = this.pressed.has(index) ? .4 : .55;
      if (button.pressed || button.value > threshold) this.pressed.add(index);
      else this.pressed.delete(index);
    });
    const active = new Set<Action>();
    for (const [action, index] of Object.entries(map)) {
      if (this.pressed.has(index) && !(index >= 12 && index <= 15)) active.add(action as Action);
    }
    directions.forEach(([index, action]) => { if (this.pressed.has(index)) active.add(action); });
    const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
    const threshold = this.direction ? deadzone * .7 : deadzone;
    const wasHorizontal = this.direction === 'left' || this.direction === 'right';
    const nearDiagonal = Math.abs(Math.abs(x) - Math.abs(y)) < .12;
    const horizontal = this.direction && nearDiagonal ? wasHorizontal : Math.abs(x) > Math.abs(y);
    if (Math.max(Math.abs(x), Math.abs(y)) <= threshold) this.direction = undefined;
    else if (horizontal) this.direction = x > 0 ? 'right' : 'left';
    else this.direction = y > 0 ? 'down' : 'up';
    if (!directions.some(([index]) => this.pressed.has(index)) && this.direction) active.add(this.direction);
    for (const [a, b] of [['up', 'down'], ['left', 'right'], ['rewind', 'forward']] as [Action, Action][]) {
      if (active.has(a) && active.has(b)) { active.delete(a); active.delete(b); }
    }
    for (const action of this.suppressed) if (!active.has(action)) this.suppressed.delete(action);
    // Back wins; competing held buttons must be released before they can act again.
    if (active.has('back')) {
      for (const action of active) if (action !== 'back') this.suppressed.add(action);
    }
    for (const action of this.suppressed) active.delete(action);
    for (const action of this.held.keys()) if (!active.has(action)) this.held.delete(action);
    const output: Action[] = [];
    for (const action of active) {
      const next = this.held.get(action);
      if (next === undefined) {
        output.push(action);
        this.held.set(action, now + 420);
      } else if (repeatable.has(action) && now >= next) {
        output.push(action);
        this.held.set(action, now + 115);
      }
    }
    return output;
  }
}

export { nearest, type Rect } from './geometry';
export { activeFocusScope, ensureFocus, focusables, focusElement, moveFocus } from './focus';
