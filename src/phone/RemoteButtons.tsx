import { useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Undo2, Menu } from 'lucide-react';
import { controllerLabels, type ControllerAction, type ControllerCommand, type ControllerReply } from '../shared/remote-control';
import { ControlButton } from './ControlButton';
import { Touchpad } from './Touchpad';
import { ShortcutSettings, loadShortcuts } from './ShortcutSettings';
import { PhoneSheet } from './PhoneSheet';
import { ActionIcon } from './ActionIcon';
import { connectionError } from './connection';

export function RemoteButtons({ send }: { send: (command: ControllerCommand) => Promise<ControllerReply> }) {
  const [shortcuts, setShortcuts] = useState(loadShortcuts), [settings, setSettings] = useState(false);
  const [error, setError] = useState('');
  const opener = useRef<HTMLElement | null>(null), pending = useRef(0);
  const action = (action: ControllerAction) => {
    if (pending.current >= 2) return;
    pending.current++;
    void send({ kind: 'action', action }).then(() => setError(''), failure => setError(connectionError(failure)))
      .finally(() => { pending.current--; });
  };
  return <section className="phone-buttons" aria-label="按键遥控">
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="navigation"><div className="dpad">
      <ControlButton action="up" label="上" className="up" repeat send={action}><ChevronUp /></ControlButton>
      <ControlButton action="left" label="左" className="left" repeat send={action}><ChevronLeft /></ControlButton>
      <ControlButton action="confirm" label="确认" className="confirm" send={action} />
      <ControlButton action="right" label="右" className="right" repeat send={action}><ChevronRight /></ControlButton>
      <ControlButton action="down" label="下" className="down" repeat send={action}><ChevronDown /></ControlButton>
    </div><div className="utility-row">
      <ControlButton action="back" label="返回" send={action}><Undo2 size={19} />返回</ControlButton>
      <ControlButton action="menu" label="菜单" send={action}><Menu size={19} />菜单</ControlButton>
    </div><Touchpad send={action} /></div>
    <div className="shortcuts">{shortcuts.map((item, index) => <ControlButton key={index} action={item}
      label={controllerLabels[item]} send={action}><ActionIcon action={item} /></ControlButton>)}</div>
    <button className="phone-load" onClick={event => { opener.current = event.currentTarget; setSettings(true); }}>自定义快捷键</button>
    {settings && <PhoneSheet title="自定义快捷键" opener={opener.current} close={() => setSettings(false)}>
      <ShortcutSettings value={shortcuts} change={setShortcuts} />
    </PhoneSheet>}
  </section>;
}
