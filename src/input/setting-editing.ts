import type { Action } from './gamepad';

type Control = HTMLSelectElement | HTMLInputElement;
function controlFor(target: EventTarget | null): Control | undefined {
  return target instanceof HTMLElement && target.closest('.settings')
    && (target instanceof HTMLSelectElement || target instanceof HTMLInputElement && target.type === 'range')
    && !target.matches(':disabled') ? target : undefined;
}

/** Focus/navigation never edits settings. Wheel scrolls the settings, even over a focused control. */
export function createSettingEditing() {
  let editing: Control | undefined;
  let rangeDrag: number | undefined;
  let tap: { control: Control; id: number; x: number; y: number } | undefined;
  const end = () => {
    editing?.removeAttribute('data-setting-editing');
    editing = undefined;
    rangeDrag = undefined;
  };
  const begin = (control: Control) => {
    end();
    editing = control;
    control.dataset.settingEditing = 'true';
  };
  const down = (event: PointerEvent) => {
    const control = controlFor(event.target);
    if (control !== editing) end();
    if (!control || !event.isPrimary || event.button !== 0) return;
    if (control instanceof HTMLInputElement) {
      if (editing === control) { rangeDrag = event.pointerId; return; }
      event.preventDefault();
      control.focus({ preventScroll: true });
    }
    tap = { control, id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const move = (event: PointerEvent) => {
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) { tap = undefined; end(); }
  };
  const up = (event: PointerEvent) => {
    if (tap?.id === event.pointerId) begin(tap.control);
    else if (rangeDrag === event.pointerId) end();
    tap = undefined;
  };
  const cancel = () => { tap = undefined; end(); };
  const focus = () => { if (document.activeElement !== editing) end(); };
  const changed = (event: Event) => {
    if (event.isTrusted && event.target === editing && editing instanceof HTMLSelectElement) end();
  };
  const wheel = (event: WheelEvent) => {
    const control = controlFor(event.target);
    if (!control) return;
    event.preventDefault();
    end();
    control.closest('.modal')?.scrollBy({ top: event.deltaY, left: event.deltaX, behavior: 'instant' });
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('focusin', focus);
  document.addEventListener('change', changed);
  document.addEventListener('wheel', wheel, { capture: true, passive: false });
  window.addEventListener('blur', end);
  return {
    action(action: Action) {
      const control = controlFor(document.activeElement);
      if (!control) { end(); return false; }
      if (editing && (action === 'back' || action === 'confirm')) { end(); return true; }
      if (action === 'confirm') { begin(control); return true; }
      if (!editing && (action === 'left' || action === 'right')) return true;
      if (action === 'up' || action === 'down') end();
      return false;
    },
    destroy() {
      end();
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('change', changed);
      document.removeEventListener('wheel', wheel, true);
      window.removeEventListener('blur', end);
    },
  };
}
