import { useId } from 'react';
import { RotateCcw } from 'lucide-react';
import { defaultPreferences, type Preferences } from '../shared/types';
import { actionLabels, buttonLabel } from '../input/bindings';
import { useBindingCapture } from '../input/use-binding-capture';

interface Props {
  value: Preferences;
  change: (value: Preferences) => void;
  device: string;
}

export function GamepadSettings({ value, change, device }: Props) {
  const { binding, feedback, begin } = useBindingCapture(value, change, device);
  const deadzoneId = useId();
  const standard = !device || Array.from(navigator.getGamepads?.() || []).find(pad => pad?.id === device)?.mapping === 'standard';
  return (
    <>
      <p className="device-status">{device || '未检测到手柄，请连接后按任意键唤醒'}</p>
      {feedback && <p className="muted" role="status">{feedback}</p>}
      <label className="setting-row setting-range" htmlFor={deadzoneId}>
        <span><b>摇杆死区</b><small>有漂移时适当调高</small></span>
        <input
          id={deadzoneId}
          type="range"
          aria-label="摇杆死区"
          aria-valuetext={`${Math.round(value.deadzone * 100)}%`}
          min={0.1}
          max={0.8}
          step={0.02}
          value={value.deadzone}
          onChange={e => change({ ...value, deadzone: Number(e.target.value) })}
        />
        <output className="setting-value" htmlFor={deadzoneId}>
          {Math.round(value.deadzone * 100)}%
        </output>
      </label>
      <div className="bindings">
        {Object.entries(actionLabels).map(([action, label]) => (
          <button
            key={action}
            aria-pressed={binding === action}
            onClick={() => begin(action)}
            data-calibrating={binding === action || undefined}
          >
            <span>{label}</span>
            <kbd>{binding === action ? '释放后短按目标键…' : buttonLabel(value.gamepadMap[action], standard)}</kbd>
          </button>
        ))}
      </div>
      <button
        className="text-button"
        onClick={() => change({
          ...value,
          gamepadMap: { ...defaultPreferences.gamepadMap },
          deadzone: defaultPreferences.deadzone,
        })}
      >
        <RotateCcw size={15} /> 恢复默认映射
      </button>
    </>
  );
}
