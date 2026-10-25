import { useRef, useState } from 'react';
import { Check, Gauge, Layers, MonitorPlay } from 'lucide-react';
import type { CompanionPlayer, PlayerCommand } from '../shared/companion';
import { PhoneSheet } from './PhoneSheet';

export function PhonePlayerOptions({ player, disabled, control, error }: {
  error: string;
  player: CompanionPlayer; disabled: boolean; control: (command: PlayerCommand) => Promise<boolean>;
}) {
  const [menu, setMenu] = useState<'rate' | 'quality' | 'episode'>();
  const opener = useRef<HTMLElement | null>(null);
  const options = menu === 'rate' ? [.5, .75, 1, 1.25, 1.5, 2].map(id => ({ id, label: `${id}×` }))
    : menu === 'quality' ? player.qualities : player.parts.map(part => ({ id: part.id, label: part.title }));
  const selected = menu === 'rate' ? player.rate : menu === 'quality' ? player.quality : player.part;
  const titles = { rate: '播放速度', quality: '清晰度', episode: '选集' };
  return <>
    <div className="phone-player-options">
      {([
        { key: 'rate', label: `${player.rate}×`, Icon: Gauge, show: !player.live, blocked: !!player.error },
        { key: 'quality', label: player.qualities.find(value => value.id === player.quality)?.label || '清晰度', Icon: MonitorPlay, show: !!player.qualities.length },
        { key: 'episode', label: '选集', Icon: Layers, show: player.parts.length > 1 },
      ] as const).filter(option => option.show).map(({ key, label, Icon, ...option }) =>
        <button key={key} aria-label={titles[key]} disabled={disabled || ('blocked' in option && option.blocked)}
          onClick={event => { opener.current = event.currentTarget; setMenu(key); }}>
          <Icon size={18} /><span>{label}</span></button>)}
    </div>
    {menu && <PhoneSheet title={titles[menu]} opener={opener.current} close={() => setMenu(undefined)}>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="phone-action-list" role="group" aria-label={titles[menu]}>
        {options.map(option => <button key={option.id} aria-pressed={selected === option.id} disabled={disabled}
          onClick={async () => {
            const ok = await control({ operation: menu, value: option.id } as PlayerCommand);
            if (ok) setMenu(undefined);
          }}><span>{option.label}</span>{selected === option.id && <Check size={20} />}</button>)}
      </div>
    </PhoneSheet>}
  </>;
}
