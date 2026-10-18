import { useId, useState } from 'react';
import { Gamepad2, MessageSquare, Monitor, Smartphone } from 'lucide-react';
import type { Preferences } from '../shared/types';
import { GamepadSettings } from './GamepadSettings';
import { DanmakuSettings } from './DanmakuSettings';
import { PhoneControllerSetting } from './PhoneControllerSetting';
import { ViewingSettings } from './ViewingSettings';
import './settings-navigation.css';

interface SettingsProps {
  value: Preferences;
  change: (value: Preferences) => void;
  device: string;
}

export function Settings({ value, change, device }: SettingsProps) {
  const [section, setSection] = useState('viewing');
  const id = useId();
  const sections = [
    { key: 'viewing', label: '观看', icon: Monitor },
    { key: 'danmaku', label: '弹幕', icon: MessageSquare },
    { key: 'phone', label: '手机遥控', icon: Smartphone },
    { key: 'gamepad', label: '手柄', icon: Gamepad2 },
  ];
  return (
    <div className="settings">
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {sections.map(({ key, label, icon: Icon }) => (
          <button key={key} id={`${id}-${key}`} role="tab" aria-selected={section === key}
            aria-controls={`${id}-panel`} onClick={() => setSection(key)}>
            <Icon size={18} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
      </div>
      <div className="settings-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${section}`}>
        {section === 'viewing' && <ViewingSettings value={value} change={change} />}
        {section === 'danmaku' && <DanmakuSettings value={value} change={change} />}
        {section === 'phone' && <PhoneControllerSetting />}
        {section === 'gamepad' && <GamepadSettings value={value} change={change} device={device} />}
      </div>
    </div>
  );
}
