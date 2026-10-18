import { controllerActions, controllerLabels, isControllerAction, type ControllerAction } from '../shared/remote-control';

const defaults: ControllerAction[] = ['pause', 'details', 'previous', 'next', 'rewind', 'forward'];
const key = 'yingji-controller-shortcuts';
export function loadShortcuts(): ControllerAction[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null');
    if (Array.isArray(saved) && saved.length === 6 && saved.every(isControllerAction)) return saved;
  } catch { /* Invalid or unavailable local storage falls back to the six default slots. */ }
  return [...defaults];
}

export function ShortcutSettings({ value, change }: { value: ControllerAction[]; change: (value: ControllerAction[]) => void }) {
  const update = (next: ControllerAction[]) => {
    change(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep the current page usable. */ }
  };
  return <section className="customize">
    <div className="shortcut-settings">
      {value.map((action, index) => <label key={index}>快捷键 {index + 1}
        <select aria-label={`快捷键 ${index + 1}`} value={action}
          onChange={event => update(value.map((item, slot) => slot === index ? event.target.value as ControllerAction : item))}>
          {controllerActions.map(action => <option key={action} value={action}>{controllerLabels[action]}</option>)}
        </select>
      </label>)}
    </div>
    <button type="button" onClick={() => update([...defaults])}>恢复默认</button>
  </section>;
}
